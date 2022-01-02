class ChunkManager {
	constructor () {
		// Chunk loading
		this.reqChunks = {};
		this.currChunks = {};
		this.visibleChunks = {};

		this.chunksToRequest = [];
		this.requestedChunks = [];
		this.chunksToLoad = [];
		this.chunksToRender = [];
		this.chunksToUnload = [];

		this.renderDistance = 8; // RENDER DIST
		this.chunkLoadingRate = 1;
		this.chunkTick = Date.now();
		this.chunkDelay = 0; // ms

		this.neighborOffsets = [
			[0,  0,  0],
			[-1,  0,  0], // left
			[ 1,  0,  0], // right
			[ 0, -1,  0], // down
			[ 0,  1,  0], // up
			[ 0,  0, -1], // back
			[ 0,  0,  1], // front
		];
	}

	requestChunks() { // OPTIMIZE
		if (!joined || isState("disconnecting")) return;

		// Chunks to request
		let {cellSize} = world;
		let step = 1;
		let x = 0;
		let z = 0;
		let distance = 0;
	    let range = 1;
	    let direction = 'up';

		let maxChunkRevisible = 1;
		let requests = 0;
		let revisible = 0;
	    for ( let i = 0; i < this.renderDistance*this.renderDistance; i++ ) {
			
			let cellX = this.cellPos.x + x;
			let cellZ = this.cellPos.z + z;
			let chunkId = cellX + "," + cellZ;

			if (requests < this.chunkLoadingRate && !this.reqChunks[chunkId]) { // Not requested
				this.reqChunks[chunkId] = true; // Mark as requested

				// Add chunks to request
				for (let y = 0; y < (world.buildHeight+1)/cellSize; y++) {
					let cellY = y;

					this.chunksToRequest.push({
						x: cellX,
						y: cellY,
						z: cellZ
					})
				}
				requests++;
			} else if (revisible < maxChunkRevisible && !this.currChunks[chunkId] && Number.isInteger(cellX)) { // Check if chunk is loaded
				this.currChunks[chunkId] = [cellX, cellZ]; // Mark as loaded

				for (let y = 0; y < (world.buildHeight+1)/cellSize; y++) {
					let cellY = y;
					let cellId = cellX + "," + cellY + "," + cellZ;

					if (!cellIdToMesh[cellId]) continue;
					let opaqueMesh = cellIdToMesh[cellId][0];
					let transparentMesh = cellIdToMesh[cellId][1];
					
					if (opaqueMesh) opaqueMesh.visible = true;
					if (transparentMesh) transparentMesh.visible = true;
				}
				revisible++;
			} else if (requests > this.chunkLoadingRate) {
				break;
			}
	       
	        distance++;
	        switch ( direction ) {
	            case 'up':
	                z += step;
	                if ( distance >= range ) {
	                    direction = 'right';
	                    distance = 0;
	                }
	                break;
	            case 'right':
	                x += step;
	                if ( distance >= range ) {
	                    direction = 'bottom';
	                    distance = 0;
	                    range += 1;
	                }
	                break;
	            case 'bottom':
	                z -= step;
	                if ( distance >= range ) {
	                    direction = 'left';
	                    distance = 0;
	                }
	                break;
	            case 'left':
	                x -= step;
	                if ( distance >= range ) {
	                    direction = 'up';
	                    distance = 0;
	                    range += 1;
	                }
	                break;
	            default:
	                break;
	        }
	    }

		// Request chunks based on loading rate
		this.requestedChunks.length = 0;
		for (let chunk of this.chunksToRequest) {
			if (chunk) {
				this.requestedChunks.push(chunk);
			}
		}

		if (this.requestedChunks.length > 0) {
			socket.emit('requestChunk', this.requestedChunks) // Call server to load this chunk
		}
	}

	processChunks(data, type) {
		if (!joined || isState("disconnecting")) return;

		if (type == "rle") {
			let newCells = {};

			for (let i = 0; i < data.length; i++) {
				let chunk = data[i];
				let cellId = chunk.pos.x + "," + chunk.pos.y + "," + chunk.pos.z;

				world.cells[cellId] = chunk.cell;
				world.cells[cellId].set(chunk.cell);

				newCells[cellId] = world.cells[cellId];

				chunk.pos.id = cellId;

				chunkManager.chunksToLoad.push(chunk.pos)
			}

			// Update information to each voxel worker
			let worldData = {
				cells: newCells,
			}

			for (let voxelWorker of voxelWorkers) {
				voxelWorker.postMessage(worldData);
			}
		} else if (type == "voxel") {
			for (let i = 0; i < data.length; i++) {
				if (data[6]) chunkManager.chunksToRender.unshift(data[i]); // Prioritize chunks
				else chunkManager.chunksToRender.push(data[i]);
			}
		}
		
	}

	loadChunks() {
		let {cellSize} = world;

		for (var i = 0; i < this.chunkLoadingRate; i++) {
			let chunk = this.chunksToLoad[i];
			if (chunk) {
				
				let canBeLoaded = true;
				// let dir = [[1, 0], [-1, 0], [0, 1], [0, -1]];
				// for (let d of dir) {
				// 	let cellId = (chunk.x+d[0]) + "," + (chunk.y) + "," + (chunk.z+d[1]);
				// 	if (!world.cells[cellId]) { 
				// 		canBeLoaded = false;
				// 		break;
				// 	}
				// }
				
				if (canBeLoaded) {
					updateVoxelGeometry(chunk.x*cellSize, chunk.y*cellSize, chunk.z*cellSize);
					this.chunksToLoad.splice(i, 1);
				}
			}
		}
	}

	renderChunks() {
		// Render chunks based on render rate
		for (var i = 0; i < this.chunkLoadingRate; i++) {
			let chunk = this.chunksToRender[i];
			if (chunk) {
				let chunkX = chunk[1];
				let chunkZ = chunk[3];
				this.currChunks[`${chunkX},${chunkZ}`] = [chunkX, chunkZ];
				updateCellMesh(chunk, true)
				this.chunksToRender.splice(i, 1);
			}	
		}
	}

	unloadChunks(all) { // OPTIMIZE
		if (all) { // Completely unload all chunks
			this.chunksToRequest.length = 0;
			this.chunksToLoad.length = 0;
			this.chunksToRender.length = 0;

			for (let id in this.reqChunks) {
				delete this.reqChunks[id];
			}
		}

		// Loop through current cells to determine which chunks to unload
		for (let id in this.currChunks) {
			let cell = this.currChunks[id];
			let cx = cell[0];
			let cz = cell[1];

			let xDist = this.cellPos.x - cx;
			let zDist = this.cellPos.z - cz;

			let distSquared = xDist * xDist + zDist * zDist

			let renderDist = this.renderDistance * 0.75;

			if (distSquared > renderDist * renderDist || all) { // Within unload distance or all
				this.chunksToUnload.push({
					x: cx,
					z: cz,
				})

				delete this.currChunks[id];
			}
		}
		
		// Unload chunks based on loading rate
		for (var i = 0; i < this.chunkLoadingRate; i++) {
			let chunk = this.chunksToUnload[i];
			if (chunk) {
				world.deleteChunk(chunk, all);
				this.chunksToUnload.splice(i, 1);
			}
		}
	}

	update(player) {
		if (Date.now()-this.chunkTick < this.chunkDelay || this.chunkLoadingRate == 0) return;

		// Update chunks
		this.cellPos = world.computeCellFromPlayer(player.position.x, player.position.y, player.position.z);
		this.chunkTick = Date.now();

		if (!isState("disconnecting") && !this.reloading) {
			this.requestChunks(); // Request chunks
			this.loadChunks(); // Load chunks
			this.renderChunks(); // Render chunks
			this.unloadChunks(); // Unload chunks
		} else if (this.reloading || isState("disconnecting")) {

			this.unloadChunks(true);

			if (Object.keys(cellIdToMesh).length == 0 || this.chunksToUnload.length == 0) {
				this.reloading = false;
			}

		}

		this.chunksToRequest.length = 0;
	}

	reload() {
		this.reloading = true;
	}

	updateTexture() {
		textureManager.setTexture(textureManager.blockOrder);

		for (let cellId in cellIdToMesh) { // Dispose of all remaining meshes
			let mesh, meshT;

			if (cellIdToMesh[cellId]) {
				mesh = cellIdToMesh[cellId][0];
				meshT = cellIdToMesh[cellId][1];
			}

			if (mesh) mesh.material = textureManager.material;
			if (meshT) meshT.material = textureManager.materialTransparent;

		}
		
		console.log("Updating texture to " + getCookie("Material Texture") + "...");
	}
}