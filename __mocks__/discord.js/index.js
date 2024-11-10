// This file mocks the discord.js library for testing purposes

module.exports = {
    // Enhance Client mock
    Client: jest.fn().mockImplementation(() => ({
        channels: {
            fetch: jest.fn().mockImplementation((channelId) => Promise.resolve({
                id: channelId,
                send: jest.fn().mockResolvedValue({}),
                messages: {
                    fetch: jest.fn().mockResolvedValue({}),
                },
                permissionOverwrites: {
                    create: jest.fn().mockResolvedValue({}),
                    delete: jest.fn().mockResolvedValue({})
                }
            }))
        },
        users: {
            fetch: jest.fn().mockImplementation((userId) => Promise.resolve({
                id: userId,
                username: 'mockUser',
                createDM: jest.fn().mockResolvedValue({
                    id: `dm-${userId}`,
                    send: jest.fn().mockResolvedValue({}),
                    awaitMessages: jest.fn().mockImplementation(({ filter, max, time }) => {
                        const mockMessage = { 
                            content: 'test response', 
                            author: { id: userId },
                            createdTimestamp: Date.now()
                        };
                        if (!filter || filter(mockMessage)) {
                            return Promise.resolve(new Map([['messageId', mockMessage]]));
                        }
                        return Promise.reject({ message: 'time' });
                    })
                })
            }))
        },
        guilds: {
            fetch: jest.fn().mockImplementation((guildId) => Promise.resolve({
                id: guildId,
                channels: {
                    create: jest.fn().mockResolvedValue({
                        id: 'newChannel',
                        send: jest.fn().mockResolvedValue({}),
                        permissionOverwrites: {
                            create: jest.fn().mockResolvedValue({})
                        }
                    })
                }
            }))
        },
        login: jest.fn().mockResolvedValue(true),
        user: { id: 'botId', username: 'Bot' }
    })),

    // Enhanced Collection mock
    Collection: jest.fn().mockImplementation((entries = []) => {
        const map = new Map(entries);
        return {
            ...map,
            first: () => map.values().next().value,
            filter: (fn) => new Map([...map].filter(([k, v]) => fn(v, k))),
            map: (fn) => [...map.values()].map(fn)
        };
    }),

    // Empty mock objects for Discord.js constants
    GatewayIntentBits: {},
    REST: jest.fn(),
    Routes: {},
    
    // Mock for Discord's EmbedBuilder
    EmbedBuilder: jest.fn().mockImplementation(() => ({
        setColor: jest.fn().mockReturnThis(),
        setTitle: jest.fn().mockReturnThis(),
        setDescription: jest.fn().mockReturnThis(),
        addFields: jest.fn().mockReturnThis(),
        setTimestamp: jest.fn().mockReturnThis(),
        setFooter: jest.fn().mockReturnThis()
    })),

    // Mock implementation of ButtonBuilder
    ButtonBuilder: jest.fn().mockImplementation(() => {
        const button = {
            customId: null,
            // Method to set button's custom ID
            setCustomId(id) {
                this.customId = id;
                return this;
            },
            // Mock methods that return the button instance for chaining
            setLabel: jest.fn().mockReturnThis(),
            setStyle: jest.fn().mockReturnThis(),
        };
        return button;
    }),

    // Mock button style constants
    ButtonStyle: {
        Danger: 'DANGER',
        Secondary: 'SECONDARY',
        Success: 'SUCCESS',
    },

    // Mock implementation of ActionRowBuilder
    ActionRowBuilder: jest.fn().mockImplementation(() => {
        const row = {
            components: [],
            // Method to add components to the row
            addComponents(...components) {
                // Flatten array if components is an array of arrays
                const flatComponents = components.flat();
                this.components = flatComponents;
                return this;
            }
        };
        return row;
    }),

    // Enhanced message handling
    Message: jest.fn().mockImplementation(() => ({
        content: '',
        author: {},
        channel: {
            send: jest.fn().mockResolvedValue({}),
            awaitMessages: jest.fn()
        },
        reply: jest.fn().mockResolvedValue({}),
        delete: jest.fn().mockResolvedValue(true)
    })),

    // Enhanced Interaction mocking
    Interaction: jest.fn().mockImplementation(() => ({
        reply: jest.fn().mockResolvedValue({}),
        deferReply: jest.fn().mockResolvedValue({}),
        followUp: jest.fn().mockResolvedValue({}),
        editReply: jest.fn().mockResolvedValue({}),
        deleteReply: jest.fn().mockResolvedValue({}),
        user: { id: 'mockUserId', username: 'mockUser' },
        guild: { id: 'mockGuildId' },
        channel: { id: 'mockChannelId' }
    })),

    // Enhanced builders
    EmbedBuilder: jest.fn().mockImplementation(() => ({
        setColor: jest.fn().mockReturnThis(),
        setTitle: jest.fn().mockReturnThis(),
        setDescription: jest.fn().mockReturnThis(),
        addFields: jest.fn().mockReturnThis(),
        setTimestamp: jest.fn().mockReturnThis(),
        setFooter: jest.fn().mockReturnThis()
    })),

    // Enhanced permission handling
    PermissionsBitField: {
        Flags: {
            SendMessages: 1 << 0,
            ViewChannel: 1 << 1,
            ManageMessages: 1 << 2
        }
    },

    // Enhanced intents
    GatewayIntentBits: {
        Guilds: 1 << 0,
        GuildMessages: 1 << 1,
        MessageContent: 1 << 2,
        DirectMessages: 1 << 3
    },

    // Add SlashCommandBuilder mock
    SlashCommandBuilder: jest.fn().mockImplementation(() => ({
        setName: jest.fn().mockReturnThis(),
        setDescription: jest.fn().mockReturnThis(),
        addStringOption: jest.fn().mockReturnThis(),
        toJSON: jest.fn().mockReturnValue({})
    })),

    // Add SlashCommandStringOption mock if needed
    SlashCommandStringOption: jest.fn().mockImplementation(() => ({
        setName: jest.fn().mockReturnThis(),
        setDescription: jest.fn().mockReturnThis(),
        setRequired: jest.fn().mockReturnThis(),
        setAutocomplete: jest.fn().mockReturnThis(),
        addChoices: jest.fn().mockReturnThis()
    })),

    // Add StringSelectMenuBuilder mock
    StringSelectMenuBuilder: jest.fn().mockImplementation(() => ({
        setCustomId: jest.fn().mockReturnThis(),
        setPlaceholder: jest.fn().mockReturnThis(),
        addOptions: jest.fn().mockReturnThis()
    }))
};
