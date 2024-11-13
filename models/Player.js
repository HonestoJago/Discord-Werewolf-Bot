const { DataTypes } = require('sequelize');
const sequelize = require('../utils/database');

const PlayerStats = sequelize.define('PlayerStats', {
    discordId: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false
    },
    gamesPlayed: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    gamesWon: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    // Role-specific stats
    timesWerewolf: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    timesSeer: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    timesBodyguard: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    timesCupid: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    timesHunter: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    timesVillager: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    // Additional stats
    correctVotes: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    timesEliminated: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    successfulInvestigations: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    successfulProtections: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    }
});

module.exports = PlayerStats; 