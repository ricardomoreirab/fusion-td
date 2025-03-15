# Fusion TD - Tower Defense Game

A modern tower defense game built with Babylon.js and TypeScript.

## Features

- 3D tower defense gameplay with multiple tower types
- Enemy pathfinding using A* algorithm
- Wave-based enemy spawning system
- Tower placement, upgrading, and selling
- Resource management (health and money)
- Particle effects for visual feedback
- State machine architecture for game flow

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

## Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/fusion-td.git
   cd fusion-td
   ```

2. Install dependencies:
   ```
   npm install
   ```

## Development

Start the development server:
```
npm start
```

This will start a development server at http://localhost:9000 with hot reloading enabled.

## Building for Production

Build the project for production:
```
npm run build
```

The built files will be in the `dist` directory.

## Game Controls

- **Left Click**: Place selected tower / Interact with UI
- **ESC**: Cancel tower placement
- **Space**: Start next wave (when available)

## Tower Types

- **Basic Tower**: Balanced tower with medium range, damage, and fire rate
- **Fast Tower**: Rapid-fire tower with high fire rate but low damage
- **Heavy Tower**: High damage tower with low fire rate and medium range
- **Sniper Tower**: Long-range tower with high damage but very low fire rate

## Enemy Types

- **Basic Enemy**: Standard enemy with balanced stats
- **Fast Enemy**: Quick enemy with low health
- **Tank Enemy**: Slow enemy with high health
- **Boss Enemy**: Very strong enemy that appears in the final wave

## Project Structure

- `src/`: Source code
  - `game/`: Game-related code
    - `gameplay/`: Core gameplay components
      - `towers/`: Tower classes
      - `enemies/`: Enemy classes
    - `managers/`: Game managers (assets, state, etc.)
    - `states/`: Game states (menu, gameplay, game over)
  - `assets/`: Game assets (textures, models, sounds)

## Technologies Used

- [Babylon.js](https://www.babylonjs.com/) - 3D game engine
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [Webpack](https://webpack.js.org/) - Module bundler

## License

This project is licensed under the MIT License - see the LICENSE file for details. 