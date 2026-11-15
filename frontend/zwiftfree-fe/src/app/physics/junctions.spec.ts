import { choiceForKey, maneuver, turnChoices } from './junctions';
import { RoadGraph } from './road-graph';
import { crossroads, edge, line, NODES } from './testing';

describe('turnChoices', () => {
  const graph = (o = {}) => {
    const g = new RoadGraph();
    g.add(crossroads(o));
    return g;
  };
  const arrival = line(NODES[1], NODES[2]);

  it('offers left, straight and right sorted left to right, preferring straight', () => {
    const g = graph();
    const c = turnChoices(2, arrival, g.edge(12), 1, g.at(2));
    expect(c.map((x) => x.maneuver)).toEqual(['LEFT', 'STRAIGHT', 'RIGHT']);
    expect(c.map((x) => x.edge.id)).toEqual([25, 23, 24]);
    expect(c.find((x) => x.preferred)?.edge.id).toBe(23);
    expect(c[0].turn).toBeCloseTo(-90, 0);
  });

  it('prefers the more important road over a straighter minor one', () => {
    const g = graph({ 24: { rank: 2 }, 12: { rank: 2 } });
    const c = turnChoices(2, arrival, g.edge(12), 1, g.at(2));
    expect(c.find((x) => x.preferred)?.edge.id).toBe(24);
  });

  it('never offers a one-way the wrong way', () => {
    const g = graph({ 24: { forwardAllowed: false } });
    const c = turnChoices(2, arrival, g.edge(12), 1, g.at(2));
    expect(c.map((x) => x.edge.id)).toEqual([25, 23]);
  });

  it('turns around at a dead end, unless one-way', () => {
    const g = graph();
    const toEnd = line(NODES[3], NODES[6]);
    const c = turnChoices(6, toEnd, g.edge(36), 1, g.at(6));
    expect(c).toHaveLength(1);
    expect(c[0].maneuver).toBe('U_TURN');
    expect(c[0].direction).toBe(-1);

    const oneWay = edge(36, 3, 6, { backwardAllowed: false });
    expect(turnChoices(6, toEnd, oneWay, 1, [oneWay])).toEqual([]);
  });

  it('maps arrow keys to choices', () => {
    const g = graph();
    const c = turnChoices(2, arrival, g.edge(12), 1, g.at(2));
    expect(choiceForKey(c, 'left')).toBe(0);
    expect(choiceForKey(c, 'up')).toBe(1);
    expect(choiceForKey(c, 'right')).toBe(2);
    expect(choiceForKey([c[1]], 'left')).toBe(-1);
  });

  it('classifies maneuvers', () => {
    expect(maneuver(10)).toBe('STRAIGHT');
    expect(maneuver(-60)).toBe('LEFT');
    expect(maneuver(90)).toBe('RIGHT');
    expect(maneuver(175)).toBe('U_TURN');
  });
});
