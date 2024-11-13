# Discord Werewolf Bot 🐺

A sophisticated Discord bot that brings the classic social deduction game Werewolf (Mafia) to life with video and voice chat integration. This bot provides a fully automated game experience with multiple roles, private channels, and seamless phase management.

## ✨ Key Features

### 🎮 Immersive Gameplay
- **Video/Voice Integration**: Real-time face-to-face discussions during day phases
- **Automated Moderation**: Fully automated game flow with phase management
- **Private Channels**: Secure channels for werewolves and spectators
- **Direct Messaging**: Private role assignments and night actions
- **Interactive UI**: Button-based controls and rich embeds

### 🎭 Role System

#### Core Roles
- 🐺 **Werewolves**: Hunt in packs (1 per 4 players)
- 👁️ **Seer**: Investigates one player nightly
- 👥 **Villagers**: Deduce and eliminate threats

#### Special Roles
- 🛡️ **Bodyguard**: Protects players from werewolf attacks
- 💘 **Cupid**: Links players' fates through love
- 🏹 **Hunter**: Takes revenge upon death

## 🎮 Game Flow

### Setup Phase
1. Create game with `/create`
2. Players join via button or `/join`
3. Game creator configures optional roles
4. Start game when ready

### Night Zero
- Werewolves learn their teammates
- Seer receives initial investigation
- Cupid (if present) chooses lovers

### Day Phase
- All players enable cameras/mics
- Discuss and nominate suspects
- Vote to eliminate suspects

### Night Phase
- All players disable cameras/mics
- Role-specific actions occur
- Results revealed at dawn

## 🚀 Setup & Installation

### Prerequisites
- Node.js 16.9.0 or higher
- Discord Bot Token
- Discord Server with admin privileges

### Environment Setup
1. Create `.env` file:

BOT_TOKEN=your_discord_bot_token
CLIENT_ID=your_client_id
ALLOWED_CHANNEL_IDS=comma,separated,channel,ids
WEREWOLF_CATEGORY_ID=category_for_private_channels

### Installation Steps

# Clone repository
git clone https://github.com/jfrodella/discord-werewolf-bot.git

# Install dependencies
npm install

# Start the bot
node bot.js

## 🎯 Commands

### Game Management
- `/create` - Start new game session
- `/join` - Enter active game
- `/end-game` - End current game
- `/game-status` - View game state

### Player Actions
- `/action` - Submit night actions (DM only)
  - `attack` (Werewolf)
  - `investigate` (Seer)
  - `protect` (Bodyguard)
  - `choose_lovers` (Cupid)
  - `choose_target` (Hunter)

## 🛠 Technical Architecture

### Core Components
- `WerewolfGame.js` - Game state & logic
- `NightActionProcessor.js` - Night phase handling
- `Player.js` - Player state management
- `VoteProcessor.js` - Voting system
- `buttonHandler.js` - UI interactions
- `embedCreator.js` - Message formatting

### Features
- Comprehensive error handling with `GameError` class
- Extensive logging system
- State persistence
- Modular design
- Test coverage with Jest

## 🧪 Development

### Testing

# Run tests
npm test

# Run with coverage
npm run test:coverage

### Contributing
1. Fork repository
2. Create feature branch (`git checkout -b feature/NewFeature`)
3. Commit changes (`git commit -m 'Add NewFeature'`)
4. Push to branch (`git push origin feature/NewFeature`)
5. Open Pull Request

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Support & Community

- **Issues**: Report bugs via [Issue Tracker](https://github.com/jfrodella/discord-werewolf-bot/issues)
- **Questions**: Ask in [Discussions](https://github.com/jfrodella/discord-werewolf-bot/discussions)
- **Discord**: Reach out for information regarding our Discord server

## 🌟 Acknowledgments

- Built with [Discord.js](https://discord.js.org/)
- Inspired by the classic Werewolf/Mafia party game
- Documentation crafted with assistance from Claude AI
- Thanks to all contributors

---
Made with ❤️ by Jonathan Frodella
