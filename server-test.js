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

// Version info - UPDATED for Cloud Build test
const VERSION = '2.0.1';
const BUILD_DATE = new Date().toISOString();

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

// Root endpoint with version info
app.get('/', (req, res) => {
    res.json({
        message: 'ProCoil Enterprise API',
        status: 'operational',
        version: VERSION,
        buildDate: BUILD_DATE,
        timestamp: new Date().toISOString(),
        deployment: 'Automated via Cloud Build'
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        version: VERSION,
        timestamp: new Date().toISOString()
    });
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    logger.info(🚀 ProCoil Server v running on port );
    logger.info(📊 Deployed via Cloud Build at );
});
