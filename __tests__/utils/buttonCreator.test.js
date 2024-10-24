const { createRoleButtons } = require('../../utils/buttonCreator');
const { ButtonStyle } = require('discord.js');

// Mock discord.js
jest.mock('discord.js', () => ({
    ActionRowBuilder: jest.fn().mockImplementation(() => ({
        addComponents: jest.fn().mockReturnThis(),
        components: []
    })),
    ButtonBuilder: jest.fn().mockImplementation(() => {
        const button = {
            customId: '',
            label: '',
            style: null,
            setCustomId(id) { this.customId = id; return this; },
            setLabel(label) { this.label = label; return this; },
            setStyle(style) { this.style = style; return this; }
        };
        return button;
    }),
    ButtonStyle: {
        Primary: 1,
        Secondary: 2,
        Success: 3,
        Danger: 4
    }
}));

describe('Button Creator', () => {
    let mockAddComponents;
    
    beforeEach(() => {
        jest.clearAllMocks();
        const { ActionRowBuilder } = require('discord.js');
        mockAddComponents = jest.fn().mockReturnThis();
        ActionRowBuilder.mockImplementation(() => ({
            addComponents: mockAddComponents,
            components: []
        }));
    });

    test('creates add buttons with correct properties', () => {
        const buttons = createRoleButtons();
        expect(mockAddComponents).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({
                    customId: 'add_werewolf',
                    label: '➕ Werewolf',
                    style: 4  // ButtonStyle.Danger
                })
            ])
        );
    });

    test('creates werewolf button with correct properties', () => {
        createRoleButtons();
        const { ButtonBuilder } = require('discord.js');
        
        // Check werewolf button properties
        expect(ButtonBuilder.mock.results[0].value.setCustomId)
            .toHaveBeenCalledWith('add_werewolf');
        expect(ButtonBuilder.mock.results[0].value.setLabel)
            .toHaveBeenCalledWith('➕ Werewolf');
        expect(ButtonBuilder.mock.results[0].value.setStyle)
            .toHaveBeenCalledWith(ButtonStyle.Danger);
    });

    test('creates utility buttons', () => {
        createRoleButtons();
        const { ButtonBuilder } = require('discord.js');
        
        // Find view and reset buttons
        const viewButton = ButtonBuilder.mock.results.find(r => 
            r.value.setCustomId.mock.calls[0]?.[0] === 'view_roles');
        const resetButton = ButtonBuilder.mock.results.find(r => 
            r.value.setCustomId.mock.calls[0]?.[0] === 'reset_roles');
            
        expect(viewButton).toBeDefined();
        expect(resetButton).toBeDefined();
    });

    test('creates all remove buttons with correct properties', () => {
        createRoleButtons();
        const { ButtonBuilder } = require('discord.js');
        
        // Check all remove buttons
        const removeButtons = ButtonBuilder.mock.results.filter(r => 
            r.value.setCustomId.mock.calls[0]?.[0].startsWith('remove_')
        );

        expect(removeButtons).toHaveLength(5); // One for each role
        expect(removeButtons[0].value.setLabel)
            .toHaveBeenCalledWith('➖ Werewolf');
        expect(removeButtons[0].value.setStyle)
            .toHaveBeenCalledWith(ButtonStyle.Danger);
    });

    test('arranges buttons in correct order', () => {
        const buttons = createRoleButtons();
        
        // Check row order
        expect(buttons[0].addComponents).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ customId: 'add_werewolf' }),
                expect.objectContaining({ customId: 'add_seer' }),
                expect.objectContaining({ customId: 'add_doctor' }),
                expect.objectContaining({ customId: 'add_cupid' }),
                expect.objectContaining({ customId: 'add_villager' })
            ])
        );
    });

    test('creates buttons with correct styles per role', () => {
        createRoleButtons();
        const { ButtonBuilder } = require('discord.js');
        
        const buttons = ButtonBuilder.mock.results;
        
        // Check specific role styles
        const werewolfButton = buttons.find(r => 
            r.value.setCustomId.mock.calls[0]?.[0] === 'add_werewolf');
        expect(werewolfButton.value.setStyle)
            .toHaveBeenCalledWith(ButtonStyle.Danger);

        const seerButton = buttons.find(r => 
            r.value.setCustomId.mock.calls[0]?.[0] === 'add_seer');
        expect(seerButton.value.setStyle)
            .toHaveBeenCalledWith(ButtonStyle.Primary);
    });

    test('creates start game button', () => {
        createRoleButtons();
        const { ButtonBuilder } = require('discord.js');
        
        const startButton = ButtonBuilder.mock.results.find(r => 
            r.value.setCustomId.mock.calls[0]?.[0] === 'start_game'
        );
        
        expect(startButton).toBeDefined();
        expect(startButton.value.setLabel)
            .toHaveBeenCalledWith('▶️ Start Game');
        expect(startButton.value.setStyle)
            .toHaveBeenCalledWith(ButtonStyle.Success);
    });

    test('arranges utility buttons correctly', () => {
        const buttons = createRoleButtons();
        
        expect(buttons[2].addComponents).toHaveBeenCalledWith(
            expect.arrayContaining([
                expect.objectContaining({ customId: 'view_roles' }),
                expect.objectContaining({ customId: 'reset_roles' }),
                expect.objectContaining({ customId: 'start_game' })
            ])
        );
    });
});
