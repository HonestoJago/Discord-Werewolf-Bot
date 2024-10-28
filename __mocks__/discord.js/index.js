// __mocks__/discord.js/index.js

module.exports = {
    Client: jest.fn().mockImplementation(() => ({
        channels: {
            fetch: jest.fn(),
        },
    })),
    GatewayIntentBits: {},
    Collection: jest.fn(),
    REST: jest.fn(),
    Routes: {},
    EmbedBuilder: jest.fn(),
    ButtonBuilder: jest.fn().mockImplementation(() => {
        const button = {
            customId: null,
            setCustomId(id) {
                this.customId = id;
                return this;
            },
            setLabel: jest.fn().mockReturnThis(),
            setStyle: jest.fn().mockReturnThis(),
        };
        return button;
    }),
    ButtonStyle: {
        Danger: 'DANGER',
        Secondary: 'SECONDARY',
        Success: 'SUCCESS',
    },
    ActionRowBuilder: jest.fn().mockImplementation(() => {
        const row = {
            components: [],
            addComponents(...components) {
                // Flatten array if components is an array of arrays
                const flatComponents = components.flat();
                this.components = flatComponents;
                return this;
            }
        };
        return row;
    }),
};
