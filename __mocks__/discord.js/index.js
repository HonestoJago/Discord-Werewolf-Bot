// __mocks__/discord.js/index.js

const EventEmitter = require('events');

// Simplified mock classes
class MockChannel extends EventEmitter {
    constructor(name, type = 'GUILD_TEXT') {
        super();
        this.name = name;
        this.type = type;
        this.id = `${name}-id`;
        this.send = jest.fn().mockResolvedValue({ id: `${name}-message-id` });
        this.setTopic = jest.fn().mockResolvedValue(this);
        this.delete = jest.fn().mockResolvedValue(this);
        this.permissionOverwrites = {
            create: jest.fn().mockResolvedValue(true),
        };
    }
}

class MockGuild extends EventEmitter {
    constructor(id, name) {
        super();
        this.id = id;
        this.name = name;
        this.channels = {
            create: jest.fn().mockImplementation((options) => {
                // Handle both object and string parameters
                const channelName = typeof options === 'string' ? options : options.name;
                const channelType = typeof options === 'string' ? 'GUILD_TEXT' : (options.type || 'GUILD_TEXT');
                
                const channel = new MockChannel(channelName, channelType);
                
                // Handle permission overwrites if they exist
                if (options.permissionOverwrites) {
                    channel.permissionOverwrites = {
                        create: jest.fn().mockResolvedValue(true),
                    };
                }
                
                return Promise.resolve(channel);
            }),
            fetch: jest.fn().mockImplementation((channelId) => {
                if (channelId === 'channel123') {
                    return Promise.resolve(new MockChannel('test-channel'));
                }
                return Promise.resolve(null);
            }),
        };
        this.roles = {
            everyone: { id: 'everyone-role-id' },
            create: jest.fn().mockResolvedValue({
                id: 'mock-role-id',
                name: 'Mock Role',
            }),
        };
        this.members = {
            fetch: jest.fn().mockResolvedValue({
                roles: {
                    add: jest.fn().mockResolvedValue(true),
                },
            }),
        };
    }
}

class MockUser extends EventEmitter {
    constructor(id, username) {
        super();
        this.id = id;
        this.username = username;
        this.createDM = jest.fn().mockResolvedValue({
            send: jest.fn().mockResolvedValue(true),
            awaitMessages: jest.fn().mockResolvedValue({
                first: () => ({ content: 'Sample Response' }),
            }),
        });
    }
}

// Instead of a Client class, create a factory function
function createMockClient() {
    const client = new EventEmitter();
    
    // Explicitly set all required properties
    Object.defineProperties(client, {
        guilds: {
            value: {
                fetch: jest.fn().mockImplementation((guildId) => {
                    if (guildId === 'guild123') {
                        return Promise.resolve(new MockGuild('guild123', 'Test Guild'));
                    }
                    return Promise.reject(new Error('Guild not found'));
                })
            },
            writable: false,
            configurable: false
        },
        channels: {
            value: {
                fetch: jest.fn().mockImplementation((channelId) => {
                    if (channelId === 'channel123') {
                        return Promise.resolve(new MockChannel('test-channel'));
                    }
                    return Promise.reject(new Error('Channel not found'));
                })
            },
            writable: false,
            configurable: false
        },
        users: {
            value: {
                fetch: jest.fn().mockImplementation((userId) => {
                    return Promise.resolve(new MockUser(userId, `User_${userId}`));
                })
            },
            writable: false,
            configurable: false
        }
    });

    return client;
}

// Export a Client "class" that uses our factory
const Client = jest.fn().mockImplementation(() => {
    return createMockClient();
});

// Export everything else
module.exports = {
    Client,
    Guild: MockGuild,
    Channel: MockChannel,
    User: MockUser,
    GatewayIntentBits: {
        Guilds: 1,
        GuildMessages: 2,
        MessageContent: 4,
        DirectMessages: 8,
    },
    ButtonBuilder: jest.fn().mockImplementation(() => ({
        setCustomId: jest.fn().mockReturnThis(),
        setLabel: jest.fn().mockReturnThis(),
        setStyle: jest.fn().mockReturnThis(),
        toJSON: jest.fn().mockReturnValue({
            customId: 'test-id',
            label: 'Test Label',
            style: 1
        })
    })),
    ButtonStyle: {
        Primary: 1,
        Secondary: 2,
        Success: 3,
        Danger: 4,
    },
    ActionRowBuilder: jest.fn().mockImplementation(() => ({
        addComponents: jest.fn().mockReturnThis(),
        setComponents: jest.fn().mockReturnThis(),
        toJSON: jest.fn().mockReturnValue({
            type: 1,
            components: []
        })
    })),
    EmbedBuilder: jest.fn().mockImplementation(() => ({
        setColor: jest.fn().mockReturnThis(),
        setTitle: jest.fn().mockReturnThis(),
        setDescription: jest.fn().mockReturnThis(),
        addFields: jest.fn().mockReturnThis(),
        setTimestamp: jest.fn().mockReturnThis(),
        toJSON: jest.fn().mockReturnValue({
            color: '#FFA500',
            title: 'Test Title',
            description: 'Test Description',
            fields: [],
            timestamp: new Date()
        })
    })),
    PermissionsBitField: {
        Flags: {
            ViewChannel: BigInt(1),
            SendMessages: BigInt(2),
            ManageChannels: BigInt(4),
        },
    },
    MessageActionRow: jest.fn().mockImplementation(() => ({
        addComponents: jest.fn().mockReturnThis(),
        toJSON: jest.fn().mockReturnValue({
            type: 1,
            components: []
        })
    })),
    SelectMenuBuilder: jest.fn().mockImplementation(() => ({
        setCustomId: jest.fn().mockReturnThis(),
        setPlaceholder: jest.fn().mockReturnThis(),
        addOptions: jest.fn().mockReturnThis(),
        setOptions: jest.fn().mockReturnThis(),
        toJSON: jest.fn().mockReturnValue({
            type: 3,
            custom_id: 'test-select',
            options: []
        })
    })),
    ComponentType: {
        Button: 2,
        SelectMenu: 3,
        ActionRow: 1
    },
    InteractionType: {
        Ping: 1,
        ApplicationCommand: 2,
        MessageComponent: 3,
        ApplicationCommandAutocomplete: 4
    },
    MessageType: {
        Default: 0,
        RecipientAdd: 1,
        RecipientRemove: 2,
        Call: 3,
        ChannelNameChange: 4,
        ChannelIconChange: 5,
        ChannelPinnedMessage: 6,
        GuildMemberJoin: 7
    },
    ChannelType: {
        GuildText: 0,
        DM: 1,
        GuildVoice: 2,
        GroupDM: 3,
        GuildCategory: 4,
        GuildNews: 5
    }
};
