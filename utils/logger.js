// utils/logger.js

const winston = require('winston');
const path = require('path');

// Custom format for better readability
const customFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} ${level.toUpperCase()} ${message}`;
    
    // Only add metadata if it exists and has properties
    if (Object.keys(metadata).length > 0) {
        const metadataStr = JSON.stringify(metadata, null, 2);
        if (metadataStr !== '{}') {
            msg += `\n${metadataStr}`;
        }
    }
    
    return msg;
});

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        customFormat
    ),
    transports: [
        // Console output with custom formatting
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize({
                    all: true,
                    colors: {
                        info: 'blue',
                        warn: 'yellow',
                        error: 'red',
                        debug: 'gray'
                    }
                }),
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss'
                }),
                customFormat
            )
        }),
        // File output for errors
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/error.log'),
            level: 'error'
        }),
        // File output for all logs
        new winston.transports.File({
            filename: path.join(__dirname, '../logs/combined.log')
        })
    ]
});

module.exports = logger;
