// main.js — boot. Owned by: Lead (integration).
import { startGame } from './game.js';

const canvas = document.getElementById('game');
startGame(canvas, window);
