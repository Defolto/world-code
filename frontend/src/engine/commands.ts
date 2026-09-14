// Человеческие имена команд героя — для справочника и автодополнения.
// Правила — в симуляторе (simulator/world.py, COMMAND_NAMES), здесь
// только подписи. Уровень открывает команды списком `api`.
export const COMMANDS: Record<string, string> = {
  "hero.move_right": "шаг вправо",
  "hero.move_left": "шаг влево",
  "hero.move_up": "шаг вверх",
  "hero.move_down": "шаг вниз",
  "hero.wait": "постоять ход или несколько",
  "hero.take": "взять предмет под ногами",
  "hero.check_coin": "настоящая ли монета под ногами",
  "hero.can_move": "можно ли шагнуть туда",
  "hero.say": "сказать слово",
  "hero.look": "посмотреть, что под ногами",
  "hero.jump": "перепрыгнуть яму",
  "hero.crawl": "проползти под паутиной",
};
