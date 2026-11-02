// core/src/recognition/pool_memory.ts
// 一局的技能池记忆。池子满的时候认一次并记住;之后的扫描只做两件事:
//   - 补上之前没认出来的格;
//   - 看哪些格变空了(= 被选走了)。
// 已经认出来的格不再改——选到一半画面变暗、有遮挡,都不会把结果弄乱。
// 被选走也是单向的:一格一旦变空就一直算空,英雄模型一旦变灰就一直算被选走。
// 这样鼠标悬停弹出的说明框盖住已选走的格时,不会把它「复活」(2026-10-27 真机遇到过)。
import type { PoolReading } from "./pool_resolve";

export interface PoolSnapshot {
  /** 48 格记住的技能名(顺序同 readPool);从没认出来过的为 null。 */
  names: (string | null)[];
  /** 该格的技能现在是否还在池子里(本局里这格从没变空过)。 */
  available: boolean[];
  /** 英雄位置编号 → 认定的 hero_id(未认定为 null)。 */
  heroes: Map<number, number | null>;
  /** 本局里已被选走的英雄位置编号(只增不减)。 */
  takenHeroes: Set<number>;
  /** 本次扫描是否被判为「新的一局」而清空了旧记忆。 */
  reset: boolean;
}

// 新扫描里「认出来了、但和记忆不一样」的格达到这个数,且占能比较的格的大半,就认为换了一局,清空重来。
// 同一局里已认出的格不会变成另一个技能;说明框之类的遮挡最多让几格读错,不会占到大半。
export const NEW_DRAFT_MISMATCH = 4;
export const NEW_DRAFT_MISMATCH_RATIO = 0.6;

export class PoolMemory {
  private names: (string | null)[] = [];
  private heroes = new Map<number, number | null>();
  private gone: boolean[] = [];
  private taken = new Set<number>();
  private me: number | null = null;
  private myHero: number | null = null;
  private seat: number | null = null;
  private emptySeen: number[] = [];

  /** 本局里我的选位(第一轮第几个选,1..10);轮到我时才算得出。 */
  get mySeat(): number | null { return this.seat; }
  rememberMySeat(seat: number | null): void { if (this.seat === null && seat !== null) this.seat = seat; }

  /** 本局里「我」坐的行(认出过一次就记住;座位一局里不会变)。 */
  get myRow(): number | null { return this.me; }
  rememberMyRow(row: number | null): void { if (this.me === null && row !== null) this.me = row; }

  /** 本局里我选的英雄 hero_id(认出过一次就记住)。 */
  get myHeroId(): number | null { return this.myHero; }
  rememberMyHero(heroId: number | null): void { if (this.myHero === null && heroId !== null) this.myHero = heroId; }

  /** 记忆里这个位置已认定的英雄(没有为 null)。 */
  knownHero(heroPos: number): number | null {
    return this.heroes.get(heroPos) ?? null;
  }

  reset(): void {
    this.names = [];
    this.heroes = new Map();
    this.gone = [];
    this.taken = new Set();
    this.me = null;
    this.myHero = null;
    this.seat = null;
    this.emptySeen = [];
  }

  /** 并入一次扫描结果,返回当前这局的结论。 */
  /** takenHeroes:本次扫描看到已变灰的英雄位置(可不给)。
   *  onCard:这个技能是否出现在某张玩家卡上。说明框盖住的格子也会显得「空」,所以给了 onCard 时,
   *  一格要么技能确实上了卡、要么连续两次扫描都是空的,才算被选走。 */
  observe(reading: PoolReading, takenHeroes: Iterable<number> = [], onCard?: (name: string) => boolean): PoolSnapshot {
    const { cells, groups } = reading;
    let mismatch = 0, compared = 0;
    cells.forEach((c, i) => {
      const old = this.names[i] ?? null;
      if (old === null || c.name === null) return;
      compared++;
      if (c.name !== old) mismatch++;
    });
    const reset = mismatch >= NEW_DRAFT_MISMATCH && mismatch >= compared * NEW_DRAFT_MISMATCH_RATIO;
    if (reset) this.reset();

    cells.forEach((c, i) => {
      if ((this.names[i] ?? null) === null) this.names[i] = c.name; // 只补空,不覆盖
    });
    for (const g of groups) {
      if ((this.heroes.get(g.hero) ?? null) === null) this.heroes.set(g.hero, g.heroId);
    }
    cells.forEach((c, i) => {
      if (!c.empty) { this.emptySeen[i] = 0; return; }
      this.emptySeen[i] = (this.emptySeen[i] ?? 0) + 1;
      const name = this.names[i] ?? null;
      if (onCard === undefined || name === null || onCard(name) || this.emptySeen[i] >= 2) this.gone[i] = true;
    });
    for (const h of takenHeroes) this.taken.add(h);
    return {
      names: [...this.names],
      available: cells.map((_c, i) => !this.gone[i]),
      heroes: new Map(this.heroes),
      takenHeroes: new Set(this.taken),
      reset,
    };
  }
}
