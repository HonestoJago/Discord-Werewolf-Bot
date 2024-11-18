const { Sequelize } = require('sequelize');
const logger = require('./logger');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './data/werewolf.sqlite',
    logging: msg => logger.debug(msg),
    logQueryParameters: true,
    define: {
        // Add global model configuration
        timestamps: true, // Adds createdAt and updatedAt
        underscored: true, // Use snake_case for fields
        // Add JSON field support
        dialectOptions: {
            useUTC: true,
            dateStrings: true,
            typeCast: true
        }
    }
});

// Test the connection and sync schema
async function initializeDatabase() {
    try {
        await sequelize.authenticate();
        logger.info('Database connection established successfully.');
        
        // Sync all models with force:false to prevent data loss
        await sequelize.sync({ alter: true });
        logger.info('Database schema synchronized.');
    } catch (err) {
        logger.error('Unable to connect to or sync database:', err);
        throw err;
    }
}

module.exports = {
    sequelize,
    initializeDatabase
}; 