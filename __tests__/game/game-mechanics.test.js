const { setupTestGame } = require('../test-utils');
const PHASES = require('../../constants/phases');
const ROLES = require('../../constants/roles');

describe('Game Mechanics', () => {
    let game;
    let players;

    beforeEach(() => {
        const setup = setupTestGame();
        game = setup.game;
        players = setup.players;
    });

    describe('Role Interactions', () => {
        test('werewolves must agree on target', async () => {
            await game.startGame();
            game.phase = PHASES.NIGHT;

            const werewolves = Array.from(game.players.values())
                .filter(p => p.role === ROLES.WEREWOLF);
            const target = Array.from(game.players.values())
                .find(p => p.role === ROLES.VILLAGER);
            const alternateTarget = Array.from(game.players.values())
                .find(p => p.role === ROLES.SEER);

            // First werewolf attacks
            await game.processNightAction(werewolves[0].id, 'attack', target.id);

            // Second werewolf tries different target
            await expect(game.processNightAction(werewolves[1].id, 'attack', alternateTarget.id))
                .rejects.toThrow('Conflicting Attack');
        });

        test('doctor cannot protect self on consecutive nights', async () => {
            await game.startGame();
            game.phase = PHASES.NIGHT;

            const doctor = Array.from(game.players.values())
                .find(p => p.role === ROLES.DOCTOR);

            // First protection
            await game.processNightAction(doctor.id, 'protect', doctor.id);
            await game.processNightActions();

            // Try to protect self again
            game.phase = PHASES.NIGHT;
            await expect(game.processNightAction(doctor.id, 'protect', doctor.id))
                .rejects.toThrow('Invalid target');
        });

        test('seer investigation reveals correct role', async () => {
            await game.startGame();
            game.phase = PHASES.NIGHT;

            const seer = Array.from(game.players.values())
                .find(p => p.role === ROLES.SEER);
            const werewolf = Array.from(game.players.values())
                .find(p => p.role === ROLES.WEREWOLF);

            // Mock the DM function
            seer.sendDM = jest.fn();

            await game.processSeerInvestigation(seer.id, werewolf.id);
            expect(seer.sendDM).toHaveBeenCalledWith(
                expect.stringContaining('**a Werewolf**')
            );
        });
    });

    describe('Voting Mechanics', () => {
        beforeEach(async () => {
            await game.startGame();
            game.phase = PHASES.DAY;
        });

        test('majority vote required for elimination', async () => {
            const [nominator, target, seconder, ...voters] = 
                Array.from(game.players.values());
            
            await game.nominate(nominator.id, target.id);
            await game.second(seconder.id);

            // Ensure we have enough innocent votes to prevent elimination
            const innocentVoters = Math.ceil(voters.length / 2) + 1;
            for (let i = 0; i < voters.length; i++) {
                await game.submitVote(voters[i].id, i >= innocentVoters); // More innocent than guilty votes
            }

            const result = await game.processVotes();
            expect(result.eliminated).toBeNull();
            expect(target.isAlive).toBe(true);
        });

        test('dead players cannot vote', async () => {
            const [nominator, target, seconder, voter] = 
                Array.from(game.players.values());
            
            voter.isAlive = false;
            
            await game.nominate(nominator.id, target.id);
            await game.second(seconder.id);

            await expect(game.submitVote(voter.id, true))
                .rejects.toThrow('Invalid voter');
        });
    });

    describe('Lover Mechanics', () => {
        test('lovers die together from indirect causes', async () => {
            await game.startGame();
            
            const [lover1, lover2] = Array.from(game.players.values());
            await game.processLoverSelection('cupid1', `${lover1.id},${lover2.id}`);

            // Kill one lover through voting
            game.phase = PHASES.DAY;
            const nominator = Array.from(game.players.values())[2];
            await game.nominate(nominator.id, lover1.id);
            await game.second(Array.from(game.players.values())[3].id);

            // Everyone votes guilty
            for (const player of Array.from(game.players.values())) {
                if (player.isAlive && player.id !== lover1.id) {
                    await game.submitVote(player.id, true);
                }
            }

            await game.processVotes();
            expect(lover1.isAlive).toBe(false);
            expect(lover2.isAlive).toBe(false);
        });

        test('lovers cannot be protected from heartbreak', async () => {
            await game.startGame();
            game.phase = PHASES.NIGHT;

            const [lover1, lover2] = Array.from(game.players.values());
            await game.processLoverSelection('cupid1', `${lover1.id},${lover2.id}`);

            const doctor = Array.from(game.players.values())
                .find(p => p.role === ROLES.DOCTOR);

            // Protect lover2
            await game.processNightAction(doctor.id, 'protect', lover2.id);

            // Kill lover1
            lover1.isAlive = false;
            await game.handleLoversDeath(lover1);

            expect(lover2.isAlive).toBe(false);
        });
    });

    describe('Edge Cases', () => {
        test('handles simultaneous deaths correctly', async () => {
            await game.startGame();
            game.phase = PHASES.NIGHT;

            const werewolf = Array.from(game.players.values())
                .find(p => p.role === ROLES.WEREWOLF);
            const doctor = Array.from(game.players.values())
                .find(p => p.role === ROLES.DOCTOR);

            // Werewolf attacks doctor
            await game.processNightAction(werewolf.id, 'attack', doctor.id);
            // Doctor protects someone else
            const otherPlayer = Array.from(game.players.values())
                .find(p => p.id !== doctor.id && p.id !== werewolf.id);
            await game.processNightAction(doctor.id, 'protect', otherPlayer.id);

            await game.processNightActions();
            expect(doctor.isAlive).toBe(false);
            expect(otherPlayer.isAlive).toBe(true);
        });

        test('handles disconnected players gracefully', async () => {
            await game.startGame();
            game.phase = PHASES.DAY;

            // Mock the channel fetch and send
            const mockChannel = {
                send: jest.fn().mockRejectedValueOnce(new Error('Connection failed'))
            };
            game.client.channels.fetch = jest.fn().mockResolvedValue(mockChannel);

            // Mock logger
            const mockLogger = require('../../utils/logger');
            mockLogger.error = jest.fn();

            // Attempt to send message
            await game.broadcastMessage('Test message');

            // Verify channel send was attempted and error was logged
            expect(mockChannel.send).toHaveBeenCalledWith('Test message');
            expect(mockLogger.error).toHaveBeenCalled();
        });
    });
});
