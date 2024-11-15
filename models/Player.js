const { DataTypes } = require('sequelize');
const sequelize = require('../utils/database');

const PlayerStats = sequelize.define('PlayerStats', {
    discordId: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false,
        validate: {
            // Ensure it's a valid Discord snowflake
            isDiscordId(value) {
                if (!/^\d{17,19}$/.test(value)) {
                    throw new Error('Must be a valid Discord ID');
                }
            }
        }
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            // Prevent test usernames
            notTest(value) {
                if (value.toLowerCase().includes('test') || 
                    ['hunter', 'lover', 'target', 'innocent', 'voter', 'werewolf', 'victim']
                        .includes(value.toLowerCase())) {
                    throw new Error('Invalid username format');
                }
            }
        }
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