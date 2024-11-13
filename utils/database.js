const { Sequelize } = require('sequelize');
const logger = require('./logger');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './data/werewolf.sqlite',
    logging: msg => logger.debug(msg),
    logQueryParameters: true
});

// Test the connection
sequelize.authenticate()
    .then(() => {
        logger.info('Database connection established successfully.');
    })
    .catch(err => {
        logger.error('Unable to connect to the database:', err);
    });

module.exports = sequelize; 