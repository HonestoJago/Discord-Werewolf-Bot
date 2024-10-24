// __mocks__/discord.js/setup.js

const EventEmitter = require('events');

// Base mock classes
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
            create: jest.fn().mockImplementation((name, options) => {
                return Promise.resolve(new MockChannel(name, options?.type));
            }),
            fetch: jest.fn().mockImplementation((channelId) => {
                if (channelId === 'channel123') {
                    return Promise.resolve(new MockChannel('test-channel'));
                }
                return Promise.resolve(null);
            }),
        };
        this.roles = {
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

module.exports = {
    MockChannel,
    MockGuild,
    MockUser,
};
