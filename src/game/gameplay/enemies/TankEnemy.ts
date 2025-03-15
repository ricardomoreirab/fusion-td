import { Vector3 } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';

export class TankEnemy extends Enemy {
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Tank enemy has very low speed, high health, high damage, and high reward
        super(game, position, path, 1, 100, 20, 30);
    }
} 