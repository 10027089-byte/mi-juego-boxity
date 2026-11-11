export const RARITIES = {
  common: { name: 'Común', color: '#aeb8c6', particles: 0 },
  rare: { name: 'Raro', color: '#46a6ff', particles: 3 },
  epic: { name: 'Épico', color: '#ad5cff', particles: 6 },
  legendary: { name: 'Legendario', color: '#ffc928', particles: 10 },
  mythical: { name: 'Mítico', color: '#ff4d8d', particles: 18 },
  secret: { name: 'Secreto', color: '#f4f4ff', particles: 24 }
};

export const MUTATIONS = {
  normal: { name: 'Normal', incomeMultiplier: 1 },
  gold: { name: 'Dorado', incomeMultiplier: 2 },
  rainbow: { name: 'Arcoiris', incomeMultiplier: 5 }
};

export const BRAINROTS = [
  { id: 'skibidi-cube', name: 'Skibidi Cubo', rarity: 'common', price: 80, income: 8, color: '#54a9ff', shape: 'cube' },
  { id: 'sigma-rooster', name: 'Sigma Gallo', rarity: 'common', price: 150, income: 12, color: '#ffcf54', shape: 'bird' },
  { id: 'nyan-space-cat', name: 'Gato Nyan Espacial', rarity: 'rare', price: 700, income: 55, color: '#8d5cff', shape: 'cat' },
  { id: 'sneaker-shark', name: 'Tiburón con Tenis', rarity: 'rare', price: 1100, income: 85, color: '#39bfa5', shape: 'shark' },
  { id: 'pepito-keyboard', name: 'Pepe Teclado', rarity: 'rare', price: 1600, income: 110, color: '#6fcf58', shape: 'frog' },
  { id: 'banana-monkey', name: 'Chimpancé Banana', rarity: 'epic', price: 4500, income: 380, color: '#ffd84d', shape: 'ape' },
  { id: 'capybara-gold', name: 'Capibara Dorado', rarity: 'epic', price: 8000, income: 650, color: '#d89b45', shape: 'capybara' },
  { id: 'pepe-king', name: 'Pepe Rey', rarity: 'legendary', price: 30000, income: 2800, color: '#7bcf67', shape: 'frog' },
  { id: 'galaxy-croc', name: 'Cocodrilo Galactico', rarity: 'legendary', price: 60000, income: 5800, color: '#45d6c6', shape: 'shark' },
  { id: 'brainrot-emperor', name: 'Emperador Brainrot', rarity: 'mythical', price: 250000, income: 25000, color: '#ff4d8d', shape: 'ape' },
  { id: 'brainrot-404', name: 'Brainrot 404', rarity: 'secret', price: 2500000, income: 250000, color: '#f4f4ff', shape: 'cube' }
];
