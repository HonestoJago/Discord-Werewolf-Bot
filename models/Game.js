const { DataTypes } = require('sequelize');
const sequelize = require('../utils/database');

const Game = sequelize.define('Game', {
    guildId: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    channelId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    creatorId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    phase: {
        type: DataTypes.STRING,
        allowNull: false
    },
    round: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    gameState: {
        type: DataTypes.JSON,
        allowNull: false
    },
    lastUpdated: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
});

module.exports = Game; 