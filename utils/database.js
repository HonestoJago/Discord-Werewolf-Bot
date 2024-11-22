const { Sequelize, DataTypes, Op } = require('sequelize');
const logger = require('./logger');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './data/werewolf.sqlite',
    logging: msg => logger.debug(msg),
    logQueryParameters: true,
    define: {
        timestamps: true,
        underscored: true,
        dialectOptions: {
            useUTC: true,
            dateStrings: true,
            typeCast: true
        }
    }
});

// Define security models first
const RateLimit = sequelize.define('RateLimit', {
    key: {  
        type: DataTypes.STRING,
        primaryKey: true,
        validate: {
            is: /^\d{17,19}-[a-z_]+$/i
        }
    },
    lastAction: {
        type: DataTypes.DATE,
        allowNull: false,
        field: 'last_action'
    },
    actionCount: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        validate: {
            min: 0
        },
        field: 'action_count'
    },
    ipAddress: {
        type: DataTypes.STRING,
        allowNull: true,
        field: 'ip_address'
    }
}, {
    tableName: 'rate_limits',
    underscored: true,
    indexes: [
        {
            fields: ['last_action'],
            name: 'idx_ratelimit_lastaction'
        }
    ]
});

const SecurityLog = sequelize.define('SecurityLog', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    playerId: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            isDiscordId(value) {
                if (!/^\d{17,19}$/.test(value)) {
                    throw new Error('Must be a valid Discord ID');
                }
            }
        }
    },
    gameId: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            isDiscordId(value) {
                if (!/^\d{17,19}$/.test(value)) {
                    throw new Error('Must be a valid Discord ID');
                }
            }
        }
    },
    actionType: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            isIn: [['vote', 'nominate', 'action', 'join', 'ready', 'night_action']]
        }
    },
    actionData: {
        type: DataTypes.JSON,
        allowNull: true
    },
    timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    suspicious: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    reason: {
        type: DataTypes.STRING,
        allowNull: true
    },
    severity: {
        type: DataTypes.ENUM('low', 'medium', 'high'),
        defaultValue: 'low'
    }
}, {
    tableName: 'security_logs',
    underscored: true,
    indexes: [
        {
            fields: ['player_id'],
            name: 'idx_security_player'
        },
        {
            fields: ['game_id'],
            name: 'idx_security_game'
        },
        {
            fields: ['timestamp'],
            name: 'idx_security_timestamp'
        },
        {
            fields: ['suspicious'],
            name: 'idx_security_suspicious'
        }
    ]
});

// Add cleanup method
RateLimit.cleanup = async function() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await this.destroy({
        where: {
            last_action: {
                [Op.lt]: oneDayAgo
            }
        }
    });
};

// Add suspicious activity report method
SecurityLog.getSuspiciousActivity = async function(since = '24h') {
    const timeAgo = new Date(Date.now() - parseDuration(since));
    return await this.findAll({
        where: {
            suspicious: true,
            timestamp: {
                [Op.gte]: timeAgo
            }
        },
        order: [
            ['severity', 'DESC'],
            ['timestamp', 'DESC']
        ]
    });
};

function parseDuration(duration) {
    const unit = duration.slice(-1);
    const value = parseInt(duration.slice(0, -1));
    
    switch(unit) {
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        case 'w': return value * 7 * 24 * 60 * 60 * 1000;
        default: return 24 * 60 * 60 * 1000;
    }
}

// Move associations setup to a separate function
function setupAssociations() {
    const Game = require('../models/Game');
    SecurityLog.belongsTo(Game, { foreignKey: 'gameId' });
}

async function initializeDatabase() {
    try {
        await sequelize.authenticate();
        logger.info('Database connection established successfully.');
        
        // Force sync for security tables first
        await RateLimit.sync({ force: true });
        await SecurityLog.sync({ force: true });
        
        // Then sync the rest with alter
        await sequelize.sync({ alter: true });
        logger.info('Database schema synchronized.');

        const PlayerStats = require('../models/Player');
        const tableInfo = await sequelize.queryInterface.describeTable(PlayerStats.tableName);
        
        if (!tableInfo.timesMinion) {
            await sequelize.queryInterface.addColumn(
                PlayerStats.tableName,
                'timesMinion',
                {
                    type: DataTypes.INTEGER,
                    defaultValue: 0
                }
            );
            logger.info('Added timesMinion column to PlayerStats');
        }

        if (!tableInfo.timesSorcerer) {
            await sequelize.queryInterface.addColumn(
                PlayerStats.tableName,
                'timesSorcerer',
                {
                    type: DataTypes.INTEGER,
                    defaultValue: 0
                }
            );
            logger.info('Added timesSorcerer column to PlayerStats');
        }

        // Schedule cleanup
        setInterval(() => RateLimit.cleanup(), 6 * 60 * 60 * 1000);
        
        // Set up associations after all models are loaded
        setupAssociations();

        logger.info('Database initialization completed successfully');

    } catch (err) {
        logger.error('Unable to initialize database:', err);
        throw err;
    }
}

module.exports = {
    sequelize,
    initializeDatabase,
    RateLimit,
    SecurityLog,
    setupAssociations  // Export this so it can be called after all models are loaded
}; 