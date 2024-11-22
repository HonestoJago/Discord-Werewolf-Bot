const { GameError } = require('./error-handler');

class InputValidator {
    static sanitizeMessage(message) {
        if (typeof message !== 'string') return '';
        return message
            .replace(/@(everyone|here)/g, '@\u200b$1')  // Prevent @everyone/@here
            .replace(/<@&?\d+>/g, '')                   // Remove role/user mentions
            .replace(/[^\w\s.,!?-]/g, '')              // Only allow basic characters
            .trim()
            .slice(0, 2000);                           // Discord message length limit
    }

    static validateDiscordId(id) {
        if (!/^\d{17,19}$/.test(id)) {
            throw new GameError('Invalid ID', 'Invalid Discord ID format');
        }
        return id;
    }

    static validateGameAction(action, allowedActions) {
        const sanitizedAction = action.toLowerCase().trim();
        if (!allowedActions.includes(sanitizedAction)) {
            throw new GameError('Invalid Action', 'This action is not allowed');
        }
        return sanitizedAction;
    }

    static validateUsername(username) {
        if (typeof username !== 'string' || username.length < 2 || username.length > 32) {
            throw new GameError('Invalid Username', 'Username must be between 2 and 32 characters');
        }
        // Only allow alphanumeric and basic punctuation
        return username.replace(/[^\w\s-]/g, '').trim();
    }

    // Prevent SQL injection in case we use raw queries
    static sanitizeSqlInput(input) {
        if (typeof input !== 'string') return '';
        return input.replace(/['";\\]/g, '');
    }

    static validateNightAction(action, target, role) {
        // Prevent actions targeting non-existent players
        if (!target) return false;
        
        // Prevent actions during wrong phases
        if (!['NIGHT', 'NIGHT_ZERO'].includes(phase)) return false;
        
        // Validate role-specific actions
        const allowedActions = {
            'werewolf': ['attack'],
            'seer': ['investigate'],
            'bodyguard': ['protect'],
            'hunter': ['revenge'],
            'cupid': ['choose_lovers']
        };
        
        return allowedActions[role]?.includes(action) || false;
    }

    static validateVoteAction(action, voter, target, phase) {
        // Prevent dead players from voting
        if (!voter.isAlive) return false;
        
        // Prevent self-votes
        if (voter.id === target.id) return false;
        
        // Prevent voting in wrong phases
        if (phase !== 'DAY') return false;
        
        return true;
    }

    static validateEmbed(embed) {
        // Prevent massive embeds that could crash Discord
        if (JSON.stringify(embed).length > 6000) {
            throw new GameError('Embed too large', 'Message content exceeds Discord limits');
        }

        // Prevent malicious links
        if (embed.url && !embed.url.match(/^https:\/\/(discord\.com|cdn\.discordapp\.com)/)) {
            embed.url = '';
        }

        // Less aggressive sanitization for embeds - allow more formatting
        const sanitizeEmbedText = (text) => {
            if (typeof text !== 'string') return '';
            return text
                .replace(/@(everyone|here)/g, '@\u200b$1')  // Prevent @everyone/@here
                .replace(/<@&?\d+>/g, '')                   // Remove role/user mentions
                .trim()
                .slice(0, 2000);                           // Discord message length limit
        };

        // Sanitize all text fields while preserving formatting
        if (embed.title) embed.title = sanitizeEmbedText(embed.title);
        if (embed.description) embed.description = sanitizeEmbedText(embed.description);
        if (embed.footer?.text) embed.footer.text = sanitizeEmbedText(embed.footer.text);
        
        // Limit field count and content
        if (embed.fields?.length > 25) embed.fields.length = 25;
        embed.fields?.forEach(field => {
            if (field.name) field.name = sanitizeEmbedText(field.name).slice(0, 256);
            if (field.value) field.value = sanitizeEmbedText(field.value).slice(0, 1024);
        });

        // Preserve color and timestamp
        if (embed.timestamp && !(embed.timestamp instanceof Date)) {
            embed.timestamp = new Date(embed.timestamp);
        }

        return embed;
    }

    static validateInteraction(interaction, game) {
        // Verify interaction is from a valid player
        if (!game.players.has(interaction.user.id)) {
            throw new GameError('Invalid player', 'You are not in this game');
        }

        // Verify interaction is in the correct channel
        if (interaction.channelId !== game.gameChannelId) {
            throw new GameError('Wrong channel', 'This action must be performed in the game channel');
        }

        // Verify component hasn't expired
        const componentAge = Date.now() - interaction.message.createdTimestamp;
        if (componentAge > 15 * 60 * 1000) { // 15 minutes
            throw new GameError('Expired', 'This interaction has expired');
        }
    }
}

module.exports = InputValidator; 