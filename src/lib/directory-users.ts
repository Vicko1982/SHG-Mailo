export const DIRECTORY_USERS = [
  "Agapi Zoannou",
  "Alexandros",
  "Chara Giannoula",
  "Chris Bourtzoulas",
  "Dinos Stavropoulos",
  "Fang Gao",
  "Fotis Fotinias",
  "Galini Stavropoulou",
  "Ifigenia Chrisoulaki",
  "John Tzortzos",
  "Sakis Iliou",
  "Smart Homes Assistant",
  "Vasilis Katsaros",
  "Victor Stavropoulos",
] as const;

export function directoryUserId(fullName: string): string {
  return `directory:${fullName.toLocaleLowerCase().replaceAll(/\s+/g, "-")}`;
}
