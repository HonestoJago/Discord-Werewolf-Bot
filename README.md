# Discord Werewolf Bot 🐺

Welcome to the **Discord Werewolf Bot** 🐺—your gateway to the thrilling social deduction game of Werewolf (also known as Mafia) right within your Discord server! With seamless video and voice chat integration, gather your friends, form alliances, and unveil the hidden werewolves among you.

## 🎮 Core Features

### 🎭 Roles & Teams
- **Werewolf Team** 🐺
  - **Werewolves**: Hunt down villagers each night
  - **Minion**: Knows the werewolves but remains unknown to them
  - **Sorcerer**: Investigates to find the Seer, unknown to werewolves
- **Village Team** 👥
  - **Seer**: Investigates one player each night
  - **Bodyguard**: Protects one player from werewolf attacks
  - **Hunter**: Takes one player with them when killed
  - **Cupid**: Links two players as lovers at game start
  - **Villagers**: Must deduce and eliminate the werewolves

### 🎲 Gameplay Flow
1. **Setup Phase**
   - Join with intuitive buttons
   - Toggle optional roles
   - Ready-check system with DM verification
   - Real-time role distribution preview

2. **Night Phases**
   - Automated role actions via DMs
   - Private werewolf chat channel
   - Interactive dropdown menus
   - Action confirmations

3. **Day Phases**
   - Structured discussion periods
   - Nomination and voting system
   - Real-time vote tracking
   - Dynamic UI updates

### 💾 Persistence & Statistics
- **Database Integration**
  - Game state recovery after interruptions
  - Cross-server player profiles
  - Role-specific statistics
  - Achievement tracking

### 🛡️ Security & Stability
- Rate limiting and spam protection
- Input validation and sanitization
- Permission management
- Suspicious activity monitoring
- Optional DM verification
- Fallback command system

## 🚀 Getting Started

### 📋 Prerequisites
- Node.js v16.9.0+
- Discord Bot Token
- Server admin privileges
- Git for installation

### 💻 Quick Setup
1. **Clone & Install**
   ```bash
   git clone https://github.com/HonestoJago/Discord-Werewolf-Bot.git
   cd discord-werewolf-bot
   npm install
   ```

2. **Configure Environment**
   Create `.env` file:
   ```env
   BOT_TOKEN=your_discord_bot_token
   CLIENT_ID=your_client_id
   WEREWOLF_CATEGORY_ID=category_for_private_channels
   ```

3. **Launch**
   ```bash
   node bot.js
   ```

### 🎮 Player Requirements
- Enable server member DMs
- Access to game channels
- Voice chat capability
- Working camera (optional)

## 📖 Detailed Documentation

### 🎯 Win Conditions
- **Werewolf Team**: Achieve number parity with villagers
- **Village Team**: Eliminate all werewolves
- **Lovers**: Must both survive to win (alongside their team)

### 🔄 Game Cleanup
All private channels (Werewolf, Dead Players) are automatically deleted after each game.

### 🎨 UI Elements
- Context-aware buttons
- Role-specific action menus
- Real-time status updates
- Timer displays
- Fallback commands

### 📊 Statistics Tracking
- Individual performance metrics
- Role-specific rankings
- Win rates and streaks
- Cross-server leaderboards

## 🙏 Acknowledgments

- Built with [Discord.js](https://discord.js.org/)
- Inspired by the timeless Werewolf/Mafia party game
- Special thanks to:
  - **Claude 3.5 Sonnet** for extensive contributions to architecture design, code optimization, game logic, security implementation, and documentation
  - **o1-mini** for additional insights and code review
  - The Discord.js community for their excellent documentation and support

---

Made with ❤️ by Jonathan Frodella


