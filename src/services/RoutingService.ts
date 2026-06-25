// src/services/RoutingService.ts
export const getRoute = async (start: [number, number], end: [number, number]) => {
  // OSRM menggunakan format: Longitude,Latitude
  const url = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    if (data.routes && data.routes.length > 0) {
      return data.routes[0];
    }
    throw new Error("Rute tidak ditemukan");
  } catch (error) {
    console.error("Gagal mengambil rute OSRM:", error);
    throw error;
  }
};