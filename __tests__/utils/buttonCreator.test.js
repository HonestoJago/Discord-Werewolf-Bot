// __tests__/utils/buttonCreator.test.js

const { createRoleButtons } = require('../../utils/buttonCreator');
const { ButtonBuilder } = require('discord.js');

describe('Button Creator', () => {
    test('creates role buttons correctly', () => {
        const [addButtons, removeButtons, utilityButtons] = createRoleButtons();

        // Test add buttons
        expect(addButtons.components).toBeDefined();
        expect(addButtons.components.length).toBe(2);
        expect(addButtons.components[0].customId).toBe('add_doctor');
        expect(addButtons.components[1].customId).toBe('add_cupid');

        // Test remove buttons
        expect(removeButtons.components).toBeDefined();
        expect(removeButtons.components.length).toBe(2);
        expect(removeButtons.components[0].customId).toBe('remove_doctor'); // Updated to match fixed ID
        expect(removeButtons.components[1].customId).toBe('remove_cupid');

        // Test utility buttons
        expect(utilityButtons.components).toBeDefined();
        expect(utilityButtons.components.length).toBe(3);
        expect(utilityButtons.components[0].customId).toBe('view_roles');
        expect(utilityButtons.components[1].customId).toBe('reset_roles');
        expect(utilityButtons.components[2].customId).toBe('start_game');
    });
});
