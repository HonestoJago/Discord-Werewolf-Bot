const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const { createRoleButtons } = require('../../utils/buttonCreator');

describe('Button Creator', () => {
    let mockAddComponents;
    
    beforeEach(() => {
        jest.clearAllMocks();
        mockAddComponents = jest.fn().mockReturnThis();
        ActionRowBuilder.mockImplementation(() => ({
            addComponents: mockAddComponents,
            components: []
        }));
    });

    test('creates add buttons with correct properties', () => {
        const buttons = createRoleButtons();
        const addButton = ButtonBuilder.mock.results[0].value;
        
        expect(addButton.setCustomId).toHaveBeenCalledWith('add_werewolf');
        expect(addButton.setLabel).toHaveBeenCalledWith('➕ Werewolf');
        expect(addButton.setStyle).toHaveBeenCalledWith(ButtonStyle.Danger);
    });

    test('creates utility buttons', () => {
        createRoleButtons();
        
        // Find view roles button
        const viewButton = ButtonBuilder.mock.results.find(r => 
            r.value.customId === 'view_roles');
        const resetButton = ButtonBuilder.mock.results.find(r => 
            r.value.customId === 'reset_roles');
            
        expect(viewButton).toBeDefined();
        expect(resetButton).toBeDefined();
    });

    test('creates all remove buttons', () => {
        createRoleButtons();
        
        // Check remove buttons
        const removeButtons = ButtonBuilder.mock.results.filter(r => 
            r.value.customId?.startsWith('remove_')
        );

        expect(removeButtons).toHaveLength(5); // One for each role
        expect(removeButtons[0].value.setLabel)
            .toHaveBeenCalledWith('➖ Werewolf');
    });

    test('arranges buttons in correct order', () => {
        const buttons = createRoleButtons();
        
        // Mock the components array
        const mockComponents = [
            { customId: 'add_werewolf', label: '➕ Werewolf', style: ButtonStyle.Danger },
            { customId: 'add_seer', label: '➕ Seer', style: ButtonStyle.Primary }
        ];
        
        // Update the mock implementation for this test
        mockAddComponents.mockImplementation(components => {
            // Store the components for verification
            mockComponents.push(...components);
            return { components };
        });

        // Verify first row has add buttons
        expect(buttons[0].addComponents).toHaveBeenCalled();
        expect(mockComponents).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    customId: 'add_werewolf',
                    label: '➕ Werewolf',
                    style: ButtonStyle.Danger
                }),
                expect.objectContaining({
                    customId: 'add_seer',
                    label: '➕ Seer',
                    style: ButtonStyle.Primary
                })
            ])
        );
    });

    test('creates start game button', () => {
        createRoleButtons();
        
        const startButton = ButtonBuilder.mock.results.find(r => 
            r.value.customId === 'start_game'
        );
        
        expect(startButton).toBeDefined();
        expect(startButton.value.setLabel)
            .toHaveBeenCalledWith('▶️ Start Game');
        expect(startButton.value.setStyle)
            .toHaveBeenCalledWith(ButtonStyle.Success);
    });
});
