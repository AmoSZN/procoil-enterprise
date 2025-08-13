// Project Configuration
const PROJECT_CONFIG = {
    projectName: 'ProCoil Enterprise',
    projectId: 'procoil-greenfield-prod',
    projectNumber: '583044708443',
    region: 'us-central1',
    serviceName: 'procoil-paradigm'
};
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Firestore } = require('@google-cloud/firestore');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const winston = require('winston');
const helmet = require('helmet');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Initialize Firestore
const firestore = new Firestore();

// Initialize Secret Manager
const secretClient = new SecretManagerServiceClient();

// Logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console()
    ]
});

// Business configuration with 5% scrap factor
const BUSINESS_CONFIG = {
    scrapFactor: 0.05, // 5% scrap as requested
    coilWidths: [20, 43.875],
    defaultGauge: 29,
    standardRollLength: 100, // feet
    pricing: {
        marginPercent: 0.30, // 30% margin
        laborPerFoot: 0.50
    }
};

// Your Greenfield product categories
const PRODUCT_CATEGORIES = {
    coils: ['CO2024', 'CO2026', 'CO2029', 'CO4387524', 'CO4387526', 'CO4387529'],
    panels: ['A4', 'A6', 'A8'], // Your panel prefixes
    trim: ['High-Fastener', 'HF Rake', 'Overhead Door Trim', 'Com Rib Rake'],
    colors: {
        'AG': 'Ash Gray',
        'ARW': 'Arctic White',
        'AW': 'Alamo White',
        'B': 'Brown',
        'BER': 'Berry',
        'BK': 'Black',
        'BR': 'Brick Red',
        'BS': 'Burnished Slate',
        'BUR': 'Burgundy',
        'BW': 'Bone White',
        'OB': 'Ocean Blue',
        'CH': 'Charcoal',
        'EG': 'Evergreen',
        'GB': 'Gallery Blue',
        'GAL': 'Galvalume'
    }
};

// Paradigm configuration
let PARADIGM_CONFIG = null;
let authToken = null;
let tokenExpiry = null;

// Load secrets from Google Secret Manager
async function loadSecrets() {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'procoil-greenfield-prod';
    
    try {
        if (process.env.NODE_ENV === 'development') {
            // Use environment variables in development
            PARADIGM_CONFIG = {
                baseURL: process.env.PARADIGM_API_URL || 'https://greenfieldapi.para-apps.com',
                apiKey: process.env.PARADIGM_API_KEY,
                username: process.env.PARADIGM_USERNAME || 'web_admin',
                password: process.env.PARADIGM_PASSWORD
            };
        } else {
            // Use Secret Manager in production
            try {
                const [apiKeyResponse] = await secretClient.accessSecretVersion({
                    name: `projects/${projectId}/secrets/paradigm-api-key/versions/latest`
                });
                const [passwordResponse] = await secretClient.accessSecretVersion({
                    name: `projects/${projectId}/secrets/paradigm-password/versions/latest`
                });
                
                PARADIGM_CONFIG = {
                    baseURL: 'https://greenfieldapi.para-apps.com',
                    apiKey: apiKeyResponse.payload.data.toString('utf8'),
                    username: 'web_admin',
                    password: passwordResponse.payload.data.toString('utf8')
                };
            } catch (secretError) {
                logger.warn('Secret Manager not available, using environment variables');
                PARADIGM_CONFIG = {
                    baseURL: 'https://greenfieldapi.para-apps.com',
                    apiKey: process.env.PARADIGM_API_KEY || 'nVPsQFBteV&GEd7*8n0%RliVjksag8',
                    username: 'web_admin',
                    password: process.env.PARADIGM_PASSWORD || 'ChangeMe#123!'
                };
            }
        }
        
        logger.info('✅ Configuration loaded successfully');
        return true;
    } catch (error) {
        logger.error('Failed to load configuration:', error);
        return false;
    }
}

// Authenticate with Paradigm
async function authenticate() {
    try {
        // Check if token is still valid
        if (authToken && tokenExpiry && new Date() < tokenExpiry) {
            return authToken;
        }

        const response = await axios.post(
            `${PARADIGM_CONFIG.baseURL}/api/user/Auth/GetToken`,
            {
                userName: PARADIGM_CONFIG.username,
                password: PARADIGM_CONFIG.password
            },
            {
                headers: {
                    'x-api-key': PARADIGM_CONFIG.apiKey,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            }
        );
        
        authToken = response.data;
        tokenExpiry = new Date(Date.now() + 3600000); // Token expires in 1 hour
        
        logger.info('✅ Authenticated with Paradigm ERP');
        return authToken;
    } catch (error) {
        logger.error('Authentication failed:', error.message);
        throw new Error('Failed to authenticate with Paradigm');
    }
}

// ===================== ENDPOINTS =====================

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'ProCoil Enterprise API',
        status: 'operational',
        version: '2.0.1-cloud-build',
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        config: {
            scrapFactor: `${BUSINESS_CONFIG.scrapFactor * 100}%`,
            paradigmConnected: !!authToken,
            coilWidths: BUSINESS_CONFIG.coilWidths,
            categories: Object.keys(PRODUCT_CATEGORIES)
        }
    });
});

// Get your metal roofing inventory
app.get('/api/inventory/metal-roofing', async (req, res) => {
    try {
        // Check Firestore cache first
        const cacheKey = 'inventory_metal_roofing';
        const cacheRef = firestore.collection('cache').doc(cacheKey);
        const cacheDoc = await cacheRef.get();
        
        // Return cached data if fresh (5 minutes)
        if (cacheDoc.exists) {
            const cached = cacheDoc.data();
            if (cached.timestamp > Date.now() - 300000) {
                logger.info('Returning cached inventory');
                return res.json(cached.data);
            }
        }
        
        // Fetch fresh data from Paradigm
        const token = await authenticate();
        const response = await axios.get(
            `${PARADIGM_CONFIG.baseURL}/api/user/Inventory/1/500`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-api-key': PARADIGM_CONFIG.apiKey
                },
                timeout: 30000
            }
        );
        
        // Filter for metal roofing products based on your categories
        const metalProducts = response.data.filter(item => {
            const category = item.StrCategory;
            const productId = item.StrProductID || '';
            
            // Check if it's a metal roofing category
            if (category === 'Coils' || 
                category === 'Panels' || 
                category === 'Trim' ||
                category === 'Fasteners' ||
                category === 'Flatsheets') {
                return true;
            }
            
            // Check by product ID patterns
            if (productId.startsWith('CO') || 
                productId.startsWith('A4') || 
                productId.startsWith('A6') || 
                productId.startsWith('A8')) {
                return true;
            }
            
            return false;
        });
        
        // Cache the results
        await cacheRef.set({
            data: metalProducts,
            timestamp: Date.now()
        });
        
        logger.info(`Returned ${metalProducts.length} metal roofing products`);
        res.json(metalProducts);
        
    } catch (error) {
        logger.error('Inventory fetch error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch inventory',
            message: error.message 
        });
    }
});

// Optimize coil usage with 5% scrap factor
app.post('/api/optimize/coil', async (req, res) => {
    try {
        const { items, coilWidth = 43.875 } = req.body;
        
        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'No items provided' });
        }
        
        // Group items by color
        const colorGroups = {};
        items.forEach(item => {
            const color = item.color || 'UNSPECIFIED';
            if (!colorGroups[color]) {
                colorGroups[color] = [];
            }
            colorGroups[color].push(item);
        });
        
        // Optimize each color group
        const optimization = {};
        let totalLinearFeet = 0;
        let totalWithScrap = 0;
        
        Object.keys(colorGroups).forEach(color => {
            const colorItems = colorGroups[color];
            
            // Calculate base linear feet needed
            let linearFeet = 0;
            let patterns = [];
            
            colorItems.forEach(item => {
                if (item.width >= coilWidth) {
                    // Full width panels
                    linearFeet += item.quantity * item.length;
                    patterns.push({
                        type: 'Full Width',
                        product: item.productId,
                        quantity: item.quantity,
                        lengthEach: item.length,
                        totalFeet: item.quantity * item.length
                    });
                } else {
                    // Partial width trim - calculate based on nesting
                    const piecesPerRow = Math.floor(coilWidth / item.width);
                    const rowsNeeded = Math.ceil(item.quantity / piecesPerRow);
                    const feetNeeded = rowsNeeded * item.length;
                    linearFeet += feetNeeded;
                    
                    patterns.push({
                        type: 'Nested Trim',
                        product: item.productId,
                        quantity: item.quantity,
                        width: item.width,
                        piecesPerRow: piecesPerRow,
                        rowsNeeded: rowsNeeded,
                        lengthEach: item.length,
                        totalFeet: feetNeeded,
                        efficiency: `${((item.width * piecesPerRow / coilWidth) * 100).toFixed(1)}%`
                    });
                }
            });
            
            // Apply 5% scrap factor
            const scrapAmount = linearFeet * BUSINESS_CONFIG.scrapFactor;
            const totalNeeded = linearFeet + scrapAmount;
            
            // Determine which coil product to use
            const coilProduct = selectCoilProduct(color, coilWidth);
            
            optimization[color] = {
                items: colorItems,
                patterns: patterns,
                baseLinearFeet: linearFeet,
                scrapFeet: scrapAmount,
                totalLinearFeet: totalNeeded,
                coilsNeeded: Math.ceil(totalNeeded / BUSINESS_CONFIG.standardRollLength),
                efficiency: ((linearFeet / totalNeeded) * 100).toFixed(2) + '%',
                recommendedCoil: coilProduct
            };
            
            totalLinearFeet += linearFeet;
            totalWithScrap += totalNeeded;
        });
        
        // Calculate pricing
        const materialCost = totalWithScrap * 3.85; // Your base cost per foot
        const laborCost = totalWithScrap * BUSINESS_CONFIG.pricing.laborPerFoot;
        const totalCost = materialCost + laborCost;
        const sellPrice = totalCost * (1 + BUSINESS_CONFIG.pricing.marginPercent);
        
        res.json({
            optimization,
            summary: {
                totalLinearFeet: totalLinearFeet.toFixed(2),
                scrapFeet: (totalWithScrap - totalLinearFeet).toFixed(2),
                totalWithScrap: totalWithScrap.toFixed(2),
                scrapPercent: BUSINESS_CONFIG.scrapFactor * 100 + '%',
                totalCoilsNeeded: Math.ceil(totalWithScrap / BUSINESS_CONFIG.standardRollLength),
                coilWidth: coilWidth,
                pricing: {
                    materialCost: materialCost.toFixed(2),
                    laborCost: laborCost.toFixed(2),
                    totalCost: totalCost.toFixed(2),
                    sellPrice: sellPrice.toFixed(2),
                    margin: (sellPrice - totalCost).toFixed(2),
                    marginPercent: (BUSINESS_CONFIG.pricing.marginPercent * 100).toFixed(0) + '%'
                }
            }
        });
        
    } catch (error) {
        logger.error('Optimization error:', error);
        res.status(500).json({ 
            error: 'Optimization failed',
            message: error.message 
        });
    }
});

// Helper function to select appropriate coil product
function selectCoilProduct(color, width) {
    // Map color to your product codes
    const colorCode = getColorCode(color);
    const widthPrefix = width === 20 ? 'CO20' : 'CO43875';
    const gauge = '29'; // Default to 29ga
    
    return `${widthPrefix}${gauge}${colorCode}`;
}

function getColorCode(colorName) {
    // Reverse lookup from your color names to codes
    for (const [code, name] of Object.entries(PRODUCT_CATEGORIES.colors)) {
        if (name.toLowerCase() === colorName.toLowerCase()) {
            return code;
        }
    }
    return 'CUSTOM';
}

// Get orders from Paradigm
app.get('/api/orders', async (req, res) => {
    try {
        const { skip = 0, take = 100 } = req.query;
        
        const token = await authenticate();
        const response = await axios.get(
            `${PARADIGM_CONFIG.baseURL}/api/SalesOrder/${skip}/${take}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'x-api-key': PARADIGM_CONFIG.apiKey
                },
                timeout: 30000
            }
        );
        
        logger.info(`Fetched ${response.data.length} orders`);
        res.json(response.data);
        
    } catch (error) {
        logger.error('Orders fetch error:', error);
        res.status(500).json({ 
            error: 'Failed to fetch orders',
            message: error.message 
        });
    }
});

// Test endpoint for optimization with sample data
app.get('/api/test/optimize', async (req, res) => {
    const sampleItems = [
        {
            productId: 'A4AG',
            description: '24ga Ag Panel (Ash Gray)',
            color: 'Ash Gray',
            quantity: 45,
            length: 16,
            width: 43.875
        },
        {
            productId: 'RIDGE-AG',
            description: 'Ridge Cap (Ash Gray)',
            color: 'Ash Gray',
            quantity: 15,
            length: 10,
            width: 14
        },
        {
            productId: 'HIP-AG',
            description: 'Hip Cap (Ash Gray)',
            color: 'Ash Gray',
            quantity: 20,
            length: 10,
            width: 10
        }
    ];
    
    // Call optimize with sample data
    try {
        const { items, coilWidth = 43.875 } = { items: sampleItems, coilWidth: 43.875 };
        
        // Group items by color
        const colorGroups = {};
        items.forEach(item => {
            const color = item.color || 'UNSPECIFIED';
            if (!colorGroups[color]) {
                colorGroups[color] = [];
            }
            colorGroups[color].push(item);
        });
        
        // Optimize each color group
        const optimization = {};
        let totalLinearFeet = 0;
        let totalWithScrap = 0;
        
        Object.keys(colorGroups).forEach(color => {
            const colorItems = colorGroups[color];
            
            // Calculate base linear feet needed
            let linearFeet = 0;
            let patterns = [];
            
            colorItems.forEach(item => {
                if (item.width >= coilWidth) {
                    // Full width panels
                    linearFeet += item.quantity * item.length;
                    patterns.push({
                        type: 'Full Width',
                        product: item.productId,
                        quantity: item.quantity,
                        lengthEach: item.length,
                        totalFeet: item.quantity * item.length
                    });
                } else {
                    // Partial width trim - calculate based on nesting
                    const piecesPerRow = Math.floor(coilWidth / item.width);
                    const rowsNeeded = Math.ceil(item.quantity / piecesPerRow);
                    const feetNeeded = rowsNeeded * item.length;
                    linearFeet += feetNeeded;
                    
                    patterns.push({
                        type: 'Nested Trim',
                        product: item.productId,
                        quantity: item.quantity,
                        width: item.width,
                        piecesPerRow: piecesPerRow,
                        rowsNeeded: rowsNeeded,
                        lengthEach: item.length,
                        totalFeet: feetNeeded,
                        efficiency: `${((item.width * piecesPerRow / coilWidth) * 100).toFixed(1)}%`
                    });
                }
            });
            
            // Apply 5% scrap factor
            const scrapAmount = linearFeet * BUSINESS_CONFIG.scrapFactor;
            const totalNeeded = linearFeet + scrapAmount;
            
            optimization[color] = {
                items: colorItems,
                patterns: patterns,
                baseLinearFeet: linearFeet,
                scrapFeet: scrapAmount,
                totalLinearFeet: totalNeeded,
                coilsNeeded: Math.ceil(totalNeeded / BUSINESS_CONFIG.standardRollLength),
                efficiency: ((linearFeet / totalNeeded) * 100).toFixed(2) + '%'
            };
            
            totalLinearFeet += linearFeet;
            totalWithScrap += totalNeeded;
        });
        
        // Calculate pricing
        const materialCost = totalWithScrap * 3.85;
        const laborCost = totalWithScrap * BUSINESS_CONFIG.pricing.laborPerFoot;
        const totalCost = materialCost + laborCost;
        const sellPrice = totalCost * (1 + BUSINESS_CONFIG.pricing.marginPercent);
        
        res.json({
            message: 'Test optimization with sample data',
            optimization,
            summary: {
                totalLinearFeet: totalLinearFeet.toFixed(2),
                scrapFeet: (totalWithScrap - totalLinearFeet).toFixed(2),
                totalWithScrap: totalWithScrap.toFixed(2),
                scrapPercent: BUSINESS_CONFIG.scrapFactor * 100 + '%',
                totalCoilsNeeded: Math.ceil(totalWithScrap / BUSINESS_CONFIG.standardRollLength),
                coilWidth: coilWidth,
                pricing: {
                    materialCost: materialCost.toFixed(2),
                    laborCost: laborCost.toFixed(2),
                    totalCost: totalCost.toFixed(2),
                    sellPrice: sellPrice.toFixed(2),
                    margin: (sellPrice - totalCost).toFixed(2),
                    marginPercent: (BUSINESS_CONFIG.pricing.marginPercent * 100).toFixed(0) + '%'
                }
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Initialize server
const PORT = process.env.PORT || 8080;

async function startServer() {
    await loadSecrets();
    
    app.listen(PORT, () => {
        logger.info(`🚀 ProCoil Server running on port ${PORT}`);
        logger.info(`📊 Scrap Factor: ${BUSINESS_CONFIG.scrapFactor * 100}%`);
        logger.info(`📦 Product Categories: ${Object.keys(PRODUCT_CATEGORIES).join(', ')}`);
        logger.info(`🎨 Colors Configured: ${Object.keys(PRODUCT_CATEGORIES.colors).length}`);
        logger.info(`📡 Paradigm API: ${PARADIGM_CONFIG?.baseURL || 'Not configured'}`);
    });
}

startServer();


