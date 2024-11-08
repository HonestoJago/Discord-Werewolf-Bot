// Helper functions to setup common Discord.js mock scenarios
const createMockInteraction = (options = {}) => ({
    user: { id: 'testUserId', username: 'testUser', ...options.user },
    guild: { id: 'testGuildId', ...options.guild },
    channel: { id: 'testChannelId', ...options.channel },
    reply: jest.fn().mockResolvedValue({}),
    deferReply: jest.fn().mockResolvedValue({}),
    respond: jest.fn().mockResolvedValue({}),
    client: {
        games: new Map(),
        ...options.client
    },
    ...options
});

const createMockClient = (options = {}) => ({
    channels: {
        fetch: jest.fn().mockResolvedValue({
            send: jest.fn().mockResolvedValue({}),
            ...options.channel
        })
    },
    users: {
        fetch: jest.fn().mockResolvedValue({
            createDM: jest.fn().mockResolvedValue({
                send: jest.fn().mockResolvedValue({})
            })
        })
    },
    ...options
});

module.exports = {
    createMockInteraction,
    createMockClient
}; 