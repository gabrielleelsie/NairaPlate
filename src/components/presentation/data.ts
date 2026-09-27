export const naira = (value: number) =>
  `₦${Math.round(value).toLocaleString("en-NG")}`;

export const MARKET_UNITS = [
  "mudu",
  "derica",
  "paint rubber",
  "piece",
  "L",
  "measuring cup",
] as const;

export type MarketUnit = (typeof MARKET_UNITS)[number];

export type StaffProfile = {
  id: string;
  name: string;
  role: string;
  pin: string;
  initials: string;
};

export const STAFF: StaffProfile[] = [
  { id: "amaka", name: "Amaka", role: "Cook", pin: "1357", initials: "AM" },
  { id: "chidi", name: "Chidi", role: "Cashier", pin: "2468", initials: "CH" },
  { id: "tolu", name: "Mama Tolu", role: "Owner", pin: "1234", initials: "MT" },
];

export const BUSINESS_CODE = "mama-tolu";

export type IngredientRow = {
  name: string;
  stock: string;
  reorder: string;
  unit: MarketUnit | string;
  previous: number;
  current: number;
};

export const INGREDIENTS: IngredientRow[] = [
  { name: "Beef", stock: "8.4 kg", reorder: "5 kg", unit: "kg", previous: 6200, current: 7400 },
  { name: "Chicken", stock: "11.2 kg", reorder: "6 kg", unit: "kg", previous: 4800, current: 5600 },
  { name: "Egusi", stock: "4 mudu", reorder: "2 mudu", unit: "mudu", previous: 3200, current: 4100 },
  { name: "Fresh Pepper Mix", stock: "1.5 paint rubber", reorder: "1 paint rubber", unit: "paint rubber", previous: 6500, current: 9200 },
  { name: "Garri", stock: "9 mudu", reorder: "4 mudu", unit: "mudu", previous: 1400, current: 1550 },
  { name: "Onion", stock: "22 pieces", reorder: "20 pieces", unit: "piece", previous: 250, current: 420 },
  { name: "Rice", stock: "14 mudu", reorder: "6 mudu", unit: "mudu", previous: 2800, current: 3400 },
  { name: "Vegetable Oil", stock: "6.5 L", reorder: "4 L", unit: "L", previous: 2300, current: 2900 },
];

export type RecipeLine = {
  id: string;
  name: string;
  qty: number;
  unit: MarketUnit;
  unitCost: number;
};

export const PARTY_JOLLOF_LINES: RecipeLine[] = [
  { id: "rice", name: "Rice", qty: 2, unit: "mudu", unitCost: 3400 },
  { id: "pepper", name: "Fresh Pepper Mix", qty: 0.5, unit: "paint rubber", unitCost: 9200 },
  { id: "oil", name: "Vegetable Oil", qty: 0.75, unit: "L", unitCost: 2900 },
  { id: "chicken", name: "Chicken", qty: 6, unit: "piece", unitCost: 1400 },
  { id: "onion", name: "Onion", qty: 4, unit: "piece", unitCost: 420 },
  { id: "seasoning", name: "Seasoning & Spices", qty: 3, unit: "measuring cup", unitCost: 380 },
];

export const PICKABLE_INGREDIENTS: { name: string; unit: MarketUnit; unitCost: number }[] = [
  { name: "Beef", unit: "piece", unitCost: 1850 },
  { name: "Egusi", unit: "mudu", unitCost: 4100 },
  { name: "Garri", unit: "mudu", unitCost: 1550 },
  { name: "Tomato Paste", unit: "derica", unitCost: 2200 },
  { name: "Curry & Thyme", unit: "measuring cup", unitCost: 300 },
];

export type SavedRecipe = {
  name: string;
  costPerPlate: number;
  currentPrice: number;
  suggestedPrice: number;
};

export const SAVED_RECIPES: SavedRecipe[] = [
  { name: "Jollof Rice", costPerPlate: 2886, currentPrice: 3500, suggestedPrice: 4440 },
  { name: "Egusi Soup", costPerPlate: 1260, currentPrice: 2100, suggestedPrice: 1938 },
  { name: "Eba", costPerPlate: 186, currentPrice: 320, suggestedPrice: 286 },
  { name: "Fried Rice", costPerPlate: 2520, currentPrice: 4200, suggestedPrice: 3877 },
];

export const SALES_TREND = [
  { day: "Mon", sales: 78400, food: 51600 },
  { day: "Tue", sales: 86200, food: 55300 },
  { day: "Wed", sales: 92750, food: 59400 },
  { day: "Thu", sales: 88100, food: 57800 },
  { day: "Fri", sales: 112400, food: 71200 },
  { day: "Sat", sales: 134900, food: 84100 },
  { day: "Sun", sales: 61070, food: 43700 },
];

export const PNL = {
  sales: 653820,
  foodCost: 423100,
  profit: 230720,
  profitPct: 35.3,
  foodCostPct: 64.7,
};

export const CAPTIONS: string[] = [
  "One PIN. Your whole kitchen.",
  "Every kitchen job, one clean screen.",
  "Market prices move every week.",
  "Cost every plate in real market units. Pick your margin — the price follows.",
  "It flags any dish that has fallen behind.",
  "Margins you can see, every single day.",
  "Protect your food margins.",
];

export const SCREEN_TITLES = [
  "Sign in",
  "Dashboard",
  "Ingredients",
  "Price calculator",
  "Pricing review",
  "Profit & loss",
  "NairaPlate",
];
