# Discord Werewolf Bot 🐺 (Early Development)

Welcome to the **Discord Werewolf Bot** 🐺—your gateway to the thrilling social deduction game of Werewolf (also known as Mafia) right within your Discord server! With seamless video and voice chat integration, gather your friends, form alliances, and unveil the hidden werewolves among you.

## 🌟 Why Choose Discord Werewolf Bot?

Embark on an immersive gaming experience where strategy, deception, and deduction come alive. Whether you're a seasoned Werewolf veteran or new to the game, our bot offers an intuitive and engaging platform to enjoy endless rounds of intrigue and fun.

## 🎮 Gameplay Overview

Dive into the classic game of Werewolf with enhanced features that make each session unique and exciting:

### 🔄 **Game Flow**

1. **Setup Phase**
   - **Start a Game**: Server admin uses `/create` to initiate a new game session.
   - **Join the Game**: Players join using the **Join** button.
   - **Configure Roles**: Use intuitive toggle buttons to customize optional roles.
   - **Role Preview**: View current role distribution with the **View Roles** button.
   - **Begin the Hunt**: Start the game when ready (minimum 4 players).

2. **Night Zero Phase**
   - **Silent Beginnings**: All players turn off cameras and microphones.
   - **Secret Actions**:
     - **Seer**: Receives initial information via DM about a random non-werewolf player.
     - **Cupid**: If active, uses dropdown menu in DM to choose two players as lovers.
   - **Automatic Transition**: Game advances to Day phase after all actions complete.

3. **Night Phase**
   - **Dark Deeds**: All players turn off cameras and microphones.
   - **Interactive DM System**:
     - **Werewolves**: Select victims through dropdown menus in their private channel.
     - **Seer**: Choose investigation targets via DM dropdown.
     - **Bodyguard**: Select protection targets through DM interface.
     - **Hunter**: Prepare revenge shot through DM selection (when eliminated).
   - **Real-time Feedback**: Immediate confirmation of action submissions.

4. **Day Phase**
   - **Enhanced Voting System**:
     - **Nomination**: Select players through dropdown menu.
     - **Seconding**: Clear button interface for supporting nominations.
     - **Voting**: Intuitive guilty/innocent buttons for each vote.
   - **Visual Feedback**: 
     - Real-time vote tallies
     - Clear indicators for nomination status
     - Embedded messages showing voting results

5. **Winning the Game**
   - **Villagers Win**: All werewolves are eliminated.
   - **Werewolves Win**: Werewolves equal or outnumber the villagers.

### 🧑‍🤝‍🧑 **Roles Explained**

- **🐺 Werewolves**: Covertly eliminate villagers at night. They communicate with each other in a private text channel within the Discord server to strategize and plan their attacks.
- **👁️ Seer**: Discover the true identity of players.
- **🛡️ Bodyguard**: Shield players from werewolf attacks.
- **💘 Cupid**: Create bonds that affect the game's outcome.
- **🏹 Hunter**: Execute a final revenge upon elimination.
- **👥 Villagers**: Work together to root out werewolves.

## 🚀 Getting Started

Ready to play? Follow these simple steps to set up the Discord Werewolf Bot on your server!

### 📋 Prerequisites

- **Node.js**: Version 16.9.0 or higher.
- **Discord Bot Token**: Obtain from the [Discord Developer Portal](https://discord.com/developers/applications).
- **Discord Server**: With administrator privileges to manage bot permissions.
- **Git**: For cloning the repository.

### 💻 Installation

1. **Clone the Repository**
   ```bash
   git clone https://github.com/HonestoJago/Discord-Werewolf-Bot.git
   ```
2. **Navigate to the Project Directory**
   ```bash
   cd discord-werewolf-bot
   ```
3. **Install Dependencies**
   ```bash
   npm install
   ```
4. **Configure Environment Variables**
   - Create a `.env` file in the root directory:
     ```env
     BOT_TOKEN=your_discord_bot_token
     CLIENT_ID=your_client_id
     ALLOWED_CHANNEL_IDS=comma,separated,channel,ids
     WEREWOLF_CATEGORY_ID=category_for_private_channels
     ```
   - **Parameters**:
     - `BOT_TOKEN`: Your Discord bot token.
     - `CLIENT_ID`: The client ID from the Discord Developer Portal.
     - `ALLOWED_CHANNEL_IDS`: (Optional) Channels where the bot can operate.
     - `WEREWOLF_CATEGORY_ID`: The category ID for private channels like Werewolf and Dead Players.

5. **Start the Bot**
   ```bash
   node bot.js
   ```

### 📑 Setting Up Discord Permissions

To ensure the bot functions correctly, assign it the following permissions when adding it to your server:

- **Manage Channels**: To create and delete private channels.
- **Send Messages**: To communicate game updates and prompts.
- **Manage Messages**: To handle user interactions effectively.
- **Embed Links**: For rich and interactive game messages.
- **Read Message History**: To keep track of game progress.
- **Use External Emojis**: To enhance the game's visual appeal.

You can generate an invite link with these permissions using the OAuth2 URL generator in the Discord Developer Portal.

## ⚙️ Available Commands

Enhance your gaming experience with a variety of commands:

### 🎲 Game Management
- `/create` - Start a new game session.
- `/join` - Enter an active game.
- `/end-game` - Terminate the current game.
- `/game-status` - View the current game state.

### 🎭 Player Actions
- `/action` - Submit your night actions (use in DMs).
  - `attack` (Werewolf)
  - `investigate` (Seer)
  - `protect` (Bodyguard)
  - `choose_lovers` (Cupid)
  - `choose_target` (Hunter)

### 📊 Player Statistics
- `/stats` - View your game statistics.

### 📜 Role Information
- `/role-info` - Get detailed information about each role.

## 🛠 Technical Architecture

Our bot is built with scalability and maintainability in mind. Here's a peek under the hood:

### 🔧 Core Components
- **WerewolfGame.js**: Manages game state and logic.
- **NightActionProcessor.js**: Handles night-phase actions.
- **Player.js**: Manages individual player states.
- **VoteProcessor.js**: Oversees the voting system.
- **Handlers**:
  - `dayPhaseHandler.js`: Manages day-phase activities.
  - `buttonHandler.js`: Handles interactive button events.
- **Utilities**:
  - `embedCreator.js`: Crafts rich embed messages.
  - `buttonCreator.js`: Generates interactive buttons.

### 📈 Features
- **Dynamic Role Assignment**: Customize roles for varied gameplay.
- **Private Channels**: Secure discussions for werewolves and dead players.
- **State Persistence**: Ensure game continuity even after interruptions.
- **Comprehensive Logging**: Keep track of game events and errors.
- **Modular Design**: Easily extendable for future features.

## 🤝 Contributing

We love community contributions! Follow these steps to become a part of the Werewolf Bot development:

1. **Fork the Repository**
2. **Create a Feature Branch**
   ```bash
   git checkout -b feature/NewFeature
   ```
3. **Commit Your Changes**
   ```bash
   git commit -m 'Add NewFeature'
   ```
4. **Push to Your Branch**
   ```bash
   git push origin feature/NewFeature
   ```
5. **Open a Pull Request**

## 📜 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## 🌐 Support & Community

Join our thriving community and get the support you need:

- **Issues**: Report bugs via the [Issue Tracker](https://github.com/HonestoJago/Discord-Werewolf-Bot/issues).
- **Discussion**: Engage with other players and developers in [Discussions](https://github.com/HonestoJago/Discord-Werewolf-Bot/discussions).
- **Discord Server**: Connect me for a private invite to the Discord server.

## 🌟 Acknowledgments

- Built with [Discord.js](https://discord.js.org/).
- Inspired by the timeless Werewolf/Mafia party game.
- Special thanks to Claude 3.5 Sonnet and o1-mini for assisting with this project!

## 📸 Screenshots

### 🎮 Game Setup
![Game Setup Interface](assets/images/game_setup.png)
*Enhanced setup interface with role toggles and player list*

### 🌅 Day Phase
![Day Phase Voting](assets/images/day_voting.png)
*Streamlined voting interface with nomination and vote tracking*

### 🎯 Player Actions
![Action Selection](assets/images/action_dm.png)
*Intuitive dropdown menus for night actions in DMs*

### 🐺 Werewolf Channel
![Werewolf Coordination](assets/images/werewolf_channel.png)
*Private werewolf channel with target selection*

### 🏆 Game End
![Victory Screen](assets/images/victory_screen.png)
*Dynamic end-game screen with role reveals and statistics*

## 🎉 Game End

At the conclusion of each game, all private channels (e.g., Werewolf and Dead Players channels) are automatically cleaned up and deleted to maintain server organization. This process is managed using the `WEREWOLF_CATEGORY_ID` specified in the environment variables.

---

Made with ❤️ by Jonathan Frodella
