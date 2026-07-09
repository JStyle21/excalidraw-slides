import { get, set } from "idb-keyval";
import { STORAGE_KEY } from "./constants";
import { createInitialDeck, parseDeckDocument } from "./deck";
import type { DeckDocument } from "./types";

export const loadDeck = async (): Promise<DeckDocument> => {
  const value = await get<unknown>(STORAGE_KEY);
  if (!value) {
    return createInitialDeck();
  }

  try {
    return parseDeckDocument(value);
  } catch {
    return createInitialDeck();
  }
};

export const saveDeck = (deck: DeckDocument) => set(STORAGE_KEY, deck);
