// Mock Discord.js
jest.mock('discord.js', () => {
    class MockEmbed {
        constructor() {
            this.data = {
                title: '',
                description: '',
                fields: [],
                color: '',
                timestamp: null
            };
        }

        setColor(color) {
            this.data.color = color;
            return this;
        }

        setTitle(title) {
            this.data.title = title;
            return this;
        }

        setDescription(desc) {
            this.data.description = desc;
            return this;
        }

        addFields(...fields) {
            this.data.fields.push(...fields);
            return this;
        }

        setTimestamp() {
            this.data.timestamp = new Date();
            return this;
        }
    }

    return {
        EmbedBuilder: jest.fn().mockImplementation(() => new MockEmbed())
    };
});

// Add beforeEach to reset mocks and data
beforeEach(() => {
    jest.clearAllMocks();
    const { EmbedBuilder } = require('discord.js');
    const mockEmbed = EmbedBuilder.mock.results[0]?.value;
    if (mockEmbed) {
        mockEmbed.data = {
            title: '',
            description: '',
            fields: [],
            color: '',
            timestamp: null
        };
    }
});

const { 
    createPlayerListEmbed,
    createNominationEmbed,
    createVotingEmbed,
    createVoteResultsEmbed,
    createDayPhaseEmbed,
    createNominationSelectEmbed
} = require('../../utils/embedCreator');
const PHASES = require('../../constants/phases');

describe('Embed Creator', () => {
    describe('Player List Embed', () => {
        test('creates player list embed with players', () => {
            const players = new Map([
                ['1', { username: 'Player1', isAlive: true }],
                ['2', { username: 'Player2', isAlive: true }]
            ]);
            const phase = PHASES.LOBBY;

            const embed = createPlayerListEmbed(players, phase);

            expect(embed.data.title).toBe('Werewolf Game Players');
            expect(embed.data.description).toContain(phase);
            expect(embed.data.fields).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    name: 'Player Count',
                    value: '2',
                    inline: true
                }),
                expect.objectContaining({
                    name: 'Players',
                    value: expect.stringContaining('Player1')
                })
            ]));
        });

        test('handles empty player list', () => {
            const players = new Map();
            const phase = PHASES.LOBBY;

            const embed = createPlayerListEmbed(players, phase);

            expect(embed.data.fields).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    name: 'Player Count',
                    value: '0',
                    inline: true
                }),
                expect.objectContaining({
                    name: 'Players',
                    value: 'No players yet'
                })
            ]));
        });
    });

    describe('Nomination Embed', () => {
        test('creates nomination embed', () => {
            const nominator = { username: 'Nominator' };
            const target = { username: 'Target' };

            const embed = createNominationEmbed(nominator, target);

            expect(embed.data.title).toBe('Player Nominated');
            expect(embed.data.description).toContain('Nominator');
            expect(embed.data.description).toContain('Target');
            expect(embed.data.fields).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    name: 'Status',
                    value: expect.stringContaining('second')
                })
            ]));
        });
    });

    describe('Voting Embed', () => {
        test('creates voting embed', () => {
            const target = { username: 'Target' };
            const seconder = { username: 'Seconder' };

            const embed = createVotingEmbed(target, seconder);

            expect(embed.data.title).toBe('Voting Started');
            expect(embed.data.description).toContain('Target');
            expect(embed.data.description).toContain('Seconder');
            expect(embed.data.fields).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    name: 'Instructions',
                    value: expect.stringContaining('vote')
                })
            ]));
        });
    });

    describe('Vote Results Embed', () => {
        test('creates vote results embed for elimination', () => {
            const target = { username: 'Target' };
            const voteCounts = { guilty: 3, innocent: 1 };
            const eliminated = true;

            const embed = createVoteResultsEmbed(target, voteCounts, eliminated);

            expect(embed.data.title).toBe('Vote Results');
            expect(embed.data.description).toContain('eliminated');
            expect(embed.data.fields).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    name: 'Votes to Lynch',
                    value: '3',
                    inline: true
                }),
                expect.objectContaining({
                    name: 'Votes to Spare',
                    value: '1',
                    inline: true
                })
            ]));
        });

        test('creates vote results embed for survival', () => {
            const target = { username: 'Target' };
            const voteCounts = { guilty: 1, innocent: 3 };
            const eliminated = false;

            const embed = createVoteResultsEmbed(target, voteCounts, eliminated);

            expect(embed.data.description).toContain('survived');
        });
    });

    describe('Day Phase Embed', () => {
        test('creates day phase embed', () => {
            const players = new Map([
                ['1', { username: 'Player1', isAlive: true }],
                ['2', { username: 'Player2', isAlive: false }]
            ]);

            const embed = createDayPhaseEmbed(players);

            expect(embed.data.title).toBe('Day Phase');
            expect(embed.data.description).toContain('Nominate');
            expect(embed.data.fields).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    name: 'Alive Players',
                    value: expect.stringContaining('Player1')
                })
            ]));
            expect(embed.data.fields[0].value).not.toContain('Player2');
        });

        test('handles nomination in progress', () => {
            const players = new Map();
            const nominationActive = true;

            const embed = createDayPhaseEmbed(players, nominationActive);

            expect(embed.data.description).toContain('nomination is in progress');
        });
    });
});
