const ACTIONS = {
    WEREWOLF: {
        id: 'attack',
        role: 'WEREWOLF',
        validate: (player, game) => player.role === 'WEREWOLF' && game.phase === 'NIGHT'
    },
    SEER: {
        id: 'investigate',
        role: 'SEER',
        validate: (player, game) => player.role === 'SEER' && game.phase === 'NIGHT'
    },
    BODYGUARD: {
        id: 'protect',
        role: 'BODYGUARD',
        validate: (player, game) => player.role === 'BODYGUARD' && game.phase === 'NIGHT'
    },
    SORCERER: {
        id: 'dark_investigate',
        role: 'SORCERER',
        validate: (player, game) => player.role === 'SORCERER' && game.phase === 'NIGHT'
    },
    HUNTER: {
        id: 'hunter_revenge',
        role: 'HUNTER',
        validate: (player, game) => player.role === 'HUNTER' && player.id === game.pendingHunterRevenge
    },
    CUPID: {
        id: 'choose_lovers',
        role: 'CUPID',
        validate: (player, game) => player.role === 'CUPID' && game.phase === 'NIGHT_ZERO'
    }
};

module.exports = ACTIONS; 