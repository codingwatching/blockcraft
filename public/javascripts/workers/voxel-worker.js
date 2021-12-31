let world, cells;
let result = [];

self.addEventListener('message', e => {
  if (e.data.cellSize) {
    world = e.data;
  } else if (!e.data.cellSize && e.data.cells) {
    for (let cellId in e.data.cells) {
      world.cells[cellId] = e.data.cells[cellId];
    }
  } else {
    cells = e.data;

    result.length = 0;

    for (let cell of cells) {
      let [cellX, cellY, cellZ, cellId, forceUpdate] = cell;
      let geometryData = generateGeometryDataForCell(cellX, cellY, cellZ, world);
      let geometryDataT = generateGeometryDataForCell(cellX, cellY, cellZ, world, true);

      result.push([geometryData, cellX, cellY, cellZ, cellId, geometryDataT, forceUpdate]);
    }

    self.postMessage(result);
  }
});

let faces = [
  { // left
    uvRow: 0,
    dir: [ -1,  0,  0, ],
    corners: [
      { pos: [ 0, 1, 0 ], uv: [ 0, 1 ], },
      { pos: [ 0, 0, 0 ], uv: [ 0, 0 ], },
      { pos: [ 0, 1, 1 ], uv: [ 1, 1 ], },
      { pos: [ 0, 0, 1 ], uv: [ 1, 0 ], },
    ],
  },
  { // right
    uvRow: 0,
    dir: [  1,  0,  0, ],
    corners: [
      { pos: [ 1, 1, 1 ], uv: [ 0, 1 ], },
      { pos: [ 1, 0, 1 ], uv: [ 0, 0 ], },
      { pos: [ 1, 1, 0 ], uv: [ 1, 1 ], },
      { pos: [ 1, 0, 0 ], uv: [ 1, 0 ], },
    ],
  },
  { // bottom
    uvRow: 1,
    dir: [  0, -1,  0, ],
    corners: [
      { pos: [ 1, 0, 1 ], uv: [ 1, 0 ], },
      { pos: [ 0, 0, 1 ], uv: [ 0, 0 ], },
      { pos: [ 1, 0, 0 ], uv: [ 1, 1 ], },
      { pos: [ 0, 0, 0 ], uv: [ 0, 1 ], },
    ],
  },
  { // top
    uvRow: 2,
    dir: [  0,  1,  0, ],
    corners: [
      { pos: [ 0, 1, 1 ], uv: [ 1, 1 ], },
      { pos: [ 1, 1, 1 ], uv: [ 0, 1 ], },
      { pos: [ 0, 1, 0 ], uv: [ 1, 0 ], },
      { pos: [ 1, 1, 0 ], uv: [ 0, 0 ], },
    ],
  },
  { // back
    uvRow: 0,
    dir: [  0,  0, -1, ],
    corners: [
      { pos: [ 1, 0, 0 ], uv: [ 0, 0 ], },
      { pos: [ 0, 0, 0 ], uv: [ 1, 0 ], },
      { pos: [ 1, 1, 0 ], uv: [ 0, 1 ], },
      { pos: [ 0, 1, 0 ], uv: [ 1, 1 ], },
    ],
  },
  { // front
    uvRow: 0,
    dir: [  0,  0,  1, ],
    corners: [
      { pos: [ 0, 0, 1 ], uv: [ 0, 0 ], },
      { pos: [ 1, 0, 1 ], uv: [ 1, 0 ], },
      { pos: [ 0, 1, 1 ], uv: [ 0, 1 ], },
      { pos: [ 1, 1, 1 ], uv: [ 1, 1 ], },
    ],
  },
];

function euclideanModulo(a,b){return(a%b+b)%b}

function computeVoxelOffset(x, y, z) {
    const {cellSize, cellSliceSize} = world;
    const voxelX = euclideanModulo(x, cellSize) | 0;
    const voxelY = euclideanModulo(y, cellSize) | 0;
    const voxelZ = euclideanModulo(z, cellSize) | 0;
    return voxelY * cellSliceSize +
           voxelZ * cellSize +
           voxelX;
}

function computeCellId(x, y, z) {
	const {cellSize} = world;
	const cellX = Math.floor(x / cellSize);
	const cellY = Math.floor(y / cellSize);
	const cellZ = Math.floor(z / cellSize);
	return cellX + "," + cellY + "," + cellZ;
}

function getCellForVoxel(x, y, z) {
    return world.cells[computeCellId(x, y, z)];
}

function getVoxel(x, y, z) {
	const cell = getCellForVoxel(x, y, z);
	if (!cell) {
	  return -1;
	}
	const voxelOffset = computeVoxelOffset(x, y, z);
	return cell[voxelOffset];
}

function addFaceData(positions, dir, corners, normals, uvs, uvRow, indices, x, y, z, uvVoxel) {
    const {tileSize, tileTextureWidth, tileTextureHeight, blockSize} = world;

    const ndx = positions.length / 3;
    for (const {pos, uv} of corners) {
      let xPos = (pos[0] + x);
      let yPos = (pos[1] + y);
      let zPos = (pos[2] + z);

      positions.push(xPos*blockSize, yPos*blockSize, zPos*blockSize);
      normals.push(...dir);
      uvs.push(
            (uvVoxel +   uv[0]) * tileSize / tileTextureWidth,
        1 - (uvRow + 1 - uv[1]) * tileSize / tileTextureHeight);
    }
    indices.push(
      ndx, ndx + 1, ndx + 2,
      ndx + 2, ndx + 1, ndx + 3,
    );
}

let transparentBlocks = ["water", "glass", "ice", "glass_black", "glass_blue", "glass_brown", "glass_cyan", "glass_gray", "glass_green", "glass_light_blue", "glass_lime", "glass_magenta", "glass_orange", "glass_pink", "glass_purple", "glass_red", "glass_silver", "glass_white", "glass_yellow"]

// Check if is transparent
function isTransparent(voxel) {
  for (let block of transparentBlocks) {
    if (world.blockId[block] == voxel) return true;
  }
}

function generateGeometryDataForCell(cellX, cellY, cellZ, world, transparent) {

  const {cellSize} = world;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const startX = cellX * cellSize;
  const startY = cellY * cellSize;
  const startZ = cellZ * cellSize;

  for (let y = 0; y < cellSize; ++y) {
    const voxelY = startY + y;
    for (let z = 0; z < cellSize; ++z) {
      const voxelZ = startZ + z;
      for (let x = 0; x < cellSize; ++x) {
        const voxelX = startX + x;
        const voxel = getVoxel(voxelX, voxelY, voxelZ);

        if (voxel <= 0)
          continue;

        // voxel 0 is sky (empty) so for UVs we start at 0
        const uvVoxel = voxel - 1;
        
        // There is a voxel here but do we need faces for it?
        let transparentTexture = isTransparent(voxel)

        // OPAQUE TEXTURES
        if (!transparent && !transparentTexture) {
          for (const {dir, corners, uvRow} of faces) {

            const neighbor = getVoxel(
                voxelX + dir[0],
                voxelY + dir[1],
                voxelZ + dir[2]);
            if (neighbor <= 0 || neighbor == 255 || (isTransparent(neighbor) && voxel != neighbor)) {
              // this voxel has no neighbor in this direction so we need a face.
              addFaceData(positions, dir, corners, normals, uvs, uvRow, indices, x, y, z, uvVoxel)
            }
          }
        }
        
        // TRANSPARENT TEXTURES
        if (transparent && transparentTexture) { // Water
          for (const {dir, corners, uvRow} of faces) {

            const neighbor = getVoxel(
                voxelX + dir[0],
                voxelY + dir[1],
                voxelZ + dir[2]);
            if (neighbor == 0 || neighbor == 255 || (isTransparent(neighbor) && voxel != neighbor)) {
              // this voxel has no neighbor in this direction so we need a face.
              addFaceData(positions, dir, corners, normals, uvs, uvRow, indices, x, y, z, uvVoxel)
            }
          }
        }
      }
    }
  }

  let positionBuffer = new Float32Array(new SharedArrayBuffer(positions.length*4));
  let normalBuffer = new Float32Array(new SharedArrayBuffer(normals.length*4));
  let uvBuffer = new Float32Array(new SharedArrayBuffer(uvs.length*4));
  let indexBuffer = new Uint16Array(new SharedArrayBuffer(indices.length*2));

  positionBuffer.set(positions);
  normalBuffer.set(normals);
  uvBuffer.set(uvs);
  indexBuffer.set(indices);

  return {
    positions: positionBuffer,
    normals: normalBuffer,
    uvs: uvBuffer,
    indices: indexBuffer,
  }
}