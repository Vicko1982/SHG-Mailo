export function sharedSpaceKey(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => Array.from(word).filter((char) => /[\p{L}\p{N}]/u.test(char)).join(""))
    .filter(Boolean);

  let key = "";
  if (words.length === 1) {
    key = Array.from(words[0]).slice(0, 3).join("");
  } else if (words.length === 2) {
    key = `${Array.from(words[0])[0] ?? ""}${Array.from(words[1]).slice(0, 2).join("")}`;
  } else if (words.length >= 3) {
    key = words.slice(0, 3).map((word) => Array.from(word)[0] ?? "").join("");
  }
  return key.toLocaleUpperCase().padEnd(3, "X").slice(0, 3);
}
