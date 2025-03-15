import { Vector3 } from '@babylonjs/core';
import { Game } from '../../Game';
import { Enemy } from './Enemy';

export class FastEnemy extends Enemy {
    constructor(game: Game, position: Vector3, path: Vector3[]) {
        // Fast enemy has high speed, very low health, low damage, and medium reward
        super(game, position, path, 5, 15, 5, 15);
    }
} 