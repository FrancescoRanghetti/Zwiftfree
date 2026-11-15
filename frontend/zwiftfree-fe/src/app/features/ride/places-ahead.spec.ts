import { Place } from '../../core/api/roads.models';
import { Course } from '../../physics/course';
import { line } from '../../physics/testing';
import { nextAlong, nextInFront, placesAlong } from './places-ahead';

const place = (name: string, lat: number, lon: number): Place => ({
  id: 1,
  name,
  kind: 'village',
  population: null,
  lat,
  lon,
});

describe('places ahead', () => {
  const course = new Course();
  // ~3.3 km due north
  course.append({
    edgeId: 1,
    direction: 1,
    edgeOffsetStartM: 0,
    endNode: null,
    pts: line([9, 46, 0], [9, 46.03, 0], 300),
  });
  const places = [
    place('Sud', 46.0, 9.0),
    place('Centro', 46.015, 9.001),
    place('Nord', 46.03, 9.0),
    place('Lontano', 46.015, 9.05),
  ];

  it('finds the places along a route in order', () => {
    const along = placesAlong(course, places);
    expect(along.map((p) => p.name)).toEqual(['Sud', 'Centro', 'Nord']);
    expect(nextAlong(along, 0)?.name).toBe('Centro');
    expect(nextAlong(along, 2000)?.name).toBe('Nord');
    expect(nextAlong(along, 3400)).toBeNull();
  });

  it('finds the nearest place in front in free ride', () => {
    expect(nextInFront(places, { lat: 46.0, lon: 9.0 }, 0)?.name).toBe('Centro');
    expect(nextInFront(places, { lat: 46.0, lon: 9.0 }, 180)).toBeNull();
  });
});
