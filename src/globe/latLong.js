/**
 * Convert latitude and longitude to 3D Cartesian coordinates.
 *
 * Latitude:  -90 (south) to +90 (north)
 * Longitude: -180 (west) to +180 (east)
 *
 * Coordinate system:
 * - Y axis points up (north pole)
 * - X/Z lie on the equatorial plane
 */

export function latLongToVector3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);

  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const z =  radius * Math.sin(phi) * Math.sin(theta);
  const y =  radius * Math.cos(phi);

  return { x, y, z };
}
