// (function() {

//////////////////////////////
// FIREBASE //
//////////////////////////////

// Create some Firebase references.
var authRef = new Firebase("https://ss16-diaspora.firebaseio.com/");
var playersRef = new Firebase("https://ss16-diaspora.firebaseio.com/players");
var planetsRef = new Firebase("https://ss16-diaspora.firebaseio.com/planets");

//////////////////////////////
// THREEJS EXTENSIONS SETUP //
//////////////////////////////

// THREEx.Planets.baseURL	= 'js/vendor/threex-planets/';

/////////////
// GLOBALS //
/////////////

var newGame = false;
var scene, camera, renderer, mouse, controls;
var clock = new THREE.Clock(true);
var pointLight1, pointLight2, particleSystem, particleOptions, cometOptions, tick = 0, planets = [], comets = [];
var id = 0;
var clicks = [];

/////////////////
// LOBBY STUFF //
/////////////////

var currentGame,
    gameID,
    gamesRef = new Firebase("https://ss16-diaspora.firebaseio.com/game"),
    gameRef;


////////////////
// AUTH STUFF //
////////////////

// Firebase will define this after authentication.
var players = {};
var currentUser;

// Authenticate the user anonymously.
if ( !authRef.getAuth() ) {
  authRef.authAnonymously( function( error, authData ) {
    if ( error ) {
      console.log('Login Failed!', error);
    }
  }, {remember: 'sessionOnly'});
}

// After authentication completes.
authRef.onAuth(function( authData ) {
  if ( !authData ) return;

  // If there's a hash in the URL, we assume it's a game id.
  if ( window.location.hash.substr(1).length ) {
    console.log('building existing game');
    gameID = window.location.hash.substr(1);
    gameRef = new Firebase("https://ss16-diaspora.firebaseio.com/game/" + gameID);
    gameRef.once('value', function(snapshot) {
      currentGame = snapshot.val();
      var planetPromises = Object.keys(currentGame.planets).map(function(planetID) {
        return planetsRef.child(currentGame.planets[planetID]).once('value', function(snapshot) {
          var planet = snapshot.val();
          planets.push( new Planet(snapshot.key(), planet.position.x, planet.position.y) );
        });
      });
      Promise.all( planetPromises ).then(function() {
        setupCurrentPlayer(authData);
      });
    });
  } else {
    // Store the game.
    console.log('creating a new game');
    gamesRef.push({
      ready: false,
      over: false,
      timestamp: new Date().getTime()
    }).then(function(snapshot) {
      gameID = snapshot.key();
      gameRef = new Firebase("https://ss16-diaspora.firebaseio.com/game/" + gameID);
      newGame = true;
      for (var i = getRandomInt(5, 10); i > 0; i--) {
        do {
          x = getRandomInt(-500, 500);
          y = getRandomInt(-500, 500);
        } while (planetIsTooClose(x, y))
        planets.push( new Planet(null, x, y) );
      }
      window.location.hash = gameID;
      setupCurrentPlayer(authData, 0);
    });
  }
});

function markAsReady() {
  playersRef.child(currentUser).update({
    ready: true
  });
}

function setupCurrentPlayer(authData) {
  // Store the user as a player.
  var playerID = playersRef.push({
    avatar: 'http://www.gravatar.com/avatar/' + CryptoJS.MD5( authData.uid ) + '?d=retro',
    gameid: gameID,
    ready: false,
    authData: authData,
    timestamp: new Date().getTime()
  }).key();
  currentUser = playerID;
  gameRef.child('players/' + playerID).set(currentUser);
  
  gameRef.child('players').on('value', function(snapshot) {
    // console.log(snapshot.val())
    playersRef.once('value', function(snapshot) {
      var data = snapshot.val();
      players = {};
      Object.keys(data).forEach(function(i) {
        if (data[i].gameid === gameID) {
          players[i] = data[i];
          playersRef.child(i).on('child_changed', function(snapshot) {
            players[i][snapshot.key()] = snapshot.val();
            isGameReady();
          });
        }
      });

    });
  });
  
  // If the user closes the tab, delete them.
  playersRef.child( currentUser ).onDisconnect().remove();
  gameRef.child('players').child( currentUser ).onDisconnect().remove();
  
  go();
}

function isGameReady() {
  if (players.length < 2) return false;
  var weAreReady = Object.keys(players).every(function(p) {
    return players[p].ready;
  });
  if (weAreReady) {
    gameRef.update({
      ready: true
    });
  }
}

function go() {
  gameRef.child('ready').on('value', function(snapshot) {
    if (snapshot.val()) console.log('EVERYONE HAS SAID THEY\'RE READY!!!!!');
    init();
    animate();
  });
  
}

////////////
// MODELS //
////////////

function Planet( fbID, x, y, units, spinning, owner ) {

  var geometry = new THREE.SphereGeometry( 50, 16, 16 );
  var material = new THREE.MeshLambertMaterial( {color: 0xffff00} );
  
  this.id = fbID || null;
  this.fbRef = this.id ? new Firebase("https://ss16-diaspora.firebaseio.com/planets/" + this.id) : null;
  
  this.mesh = new THREE.Mesh( geometry, material );
  this.mesh.position.set( x || 0, y || 0, 10 );
  this.mesh.id = ++id;

  // @TODO need to set this as the player's ID
  this.owner = null;
  this.units = units || 10;
  this.spinning = spinning || false;
  
  // Provide a reference to itself
  this.mesh.planet = this;
  
  this.getUnits = function() {
    return this.units;
  };
  
  this.setUnits = function( numUnits ) {
    this.units = numUnits;
  };
  
  this.update = function() {
    this.fbRef.update({
      units: this.units,
      owner: this.owner
    });
  }
  
  // We only want to push the planets to Firebase if this is a new game. Otherwise
  // it means there's another player that already has planets so we want to render
  // those in the exact same locations.
  if ( newGame ) {
    var newPlanetKey = planetsRef.push({
      gameid: gameID,
      units: this.units,
      owner: this.owner || null,
      position: {
        x: x || 0,
        y: y || 0
      }
    }).key();
    gameRef.child('planets').push(newPlanetKey);
    this.id = newPlanetKey;
    this.fbRef = new Firebase("https://ss16-diaspora.firebaseio.com/planets/" + this.id);
  }
  
  this.fbRef.on('value', function(dataSnapshot) {
    var data = dataSnapshot.val() || {};
    if ( data.units ) this.setUnits( data.units );
    if ( data.owner ) this.owner = data.owner;
  }.bind(this));
  
}

function Comet( startX, startY, endX, endY, size ) {
  this.startX = startX;
  this.startY = startY;
  this.endX = endX;
  this.endY = endY;

  this.particleOptions = {
    spawnRate: 1500,
    horizontalSpeed: 1.5,
    verticalSpeed: 1.33,
    timeScale: 1
  };

  this.cometOptions = {
    position: new THREE.Vector3(),
    positionRandomness: .3,
    velocity: new THREE.Vector3(),
    velocityRandomness: .5,
    color: 'red',
    colorRandomness: .2,
    turbulence: .5,
    lifetime: 2,
    sizeRandomness: .4,
    size: size || getRandomInt(10, 20)
  };

  this.cometOptions.position.x = this.startX;
  this.cometOptions.position.y = this.startY;

}

Comet.prototype.render = function() {
  var delta = clock.getDelta() * this.particleOptions.timeScale;

  tick += delta;
  if (tick < 0) tick = 0;

  this.cometOptions.position.x = this.cometOptions.position.x + 50;
  this.cometOptions.position.y = this.cometOptions.position.y + 50;

  if (delta > 0) {
    for (var x = 0; x < 15000 * delta; x++) {
      particleSystem.spawnParticle(this.cometOptions);
    }
  }

  // debugging stuff
  // if ((Math.round(tick * 100) / 100) % 1 === 0) {
  //     console.log(this)
  // }
}


// Get the players
// playersRef.on('value', function(snapshot) {
//   var data = snapshot.val() || {};
//   Object.keys(data).forEach(function(playerID) {
//     if ( data[playerID].gameid == gameID ) {
//       players[playerID] = data[playerID];
//     }
//   });
//   // console.log('players', players);
// });

// playersRef.on('child_removed', function(snapshot) {
//   // updates the players object
//   delete players[snapshot.key()];
// });


////////////////
// UTIL STUFF //
////////////////

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min)) + min;
}

function planetIsTooClose(x, y) {
  return Object.keys(planets).some(function(i) {
    var distance = Math.sqrt(Math.pow(planets[i].mesh.position.x - x, 2) + Math.pow(planets[i].mesh.position.y - y, 2));
    return distance < 200;
  });
}

///////////////////
// THREEJS STUFF //
///////////////////

function init() {

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 1, 10000 );
  
  particleSystem = new THREE.GPUParticleSystem({
		maxParticles: 250000
	});
	
	scene.add( particleSystem );

  pointLight1 = new THREE.PointLight(0xFFFFFF);
  pointLight1.position.x = 0;
  pointLight1.position.y = 800;
  pointLight1.position.z = 800;
  pointLight2 = new THREE.PointLight(0xFFFFFF);
  pointLight2.position.x = 0;
  pointLight2.position.y = -800;
  pointLight2.position.z = -800;

  scene.add(pointLight1);
  scene.add(pointLight2);

  camera.position.z = 1000;
  // console.log('planets',planets);
  planets.forEach(function( planet ) {
    scene.add( planet.mesh );
  });

  renderer = new THREE.WebGLRenderer();
  renderer.setSize( window.innerWidth, window.innerHeight );

  document.body.appendChild( renderer.domElement );
  document.addEventListener( 'mousedown', onDocumentMouseDown, false );

  controls = new THREE.TrackballControls(camera, renderer.domElement);
	controls.rotateSpeed = 5.0;
	controls.zoomSpeed = 2.2;
	controls.panSpeed = 1;
	controls.dynamicDampingFactor = 0.3;

}

function onDocumentMouseDown( event ) {

  event.preventDefault();

  var meshes = planets.map(function(planet) {
    return planet.mesh;
  });
  var raycaster = new THREE.Raycaster();
  var mouse = new THREE.Vector2();
  mouse.x = ( event.clientX / renderer.domElement.width ) * 2 - 1;
  mouse.y = - ( event.clientY / renderer.domElement.height ) * 2 + 1;
  raycaster.setFromCamera( mouse, camera );
  var intersects = raycaster.intersectObjects( meshes );

  // If they clicked on a planet
  if ( intersects.length > 0 ) {
    var clickLocation = clicks.indexOf( intersects[0].object.id );
    if ( clickLocation === -1 ) {
      clicks.push( intersects[0].object.id );
      intersects[0].object.spinning = !intersects[0].object.spinning;
    } else {
      clicks.splice(clickLocation, 1);
    }

    // If there are two planet IDs in the clicks array, send a comet from the first
    // planet to the second. Otherwise, return and do nothing;
    if (clicks.length < 2) return;
    
    var startPlanet, endPlanet;

    Object.keys(planets).forEach(function(i) {
      if ( planets[i].mesh.id == clicks[0] ) {
        startPlanet = planets[i];
      }
      if ( planets[i].mesh.id == clicks[1] ) {
        endPlanet = planets[i];
      }
      setTimeout(function() {
        planets[i].spinning = false;
      }, 500);
    });

    
    var armySize = Math.floor( startPlanet.getUnits() / 2 );
    startPlanet.setUnits( startPlanet.getUnits() - armySize );

    // If it's a neutral planet
    if ( endPlanet.owner == null ) {
      endPlanet.setUnits( endPlanet.getUnits() + armySize );
      endPlanet.owner = currentUser;
    // If an enemy owns it
    } else if ( endPlanet.owner != currentUser ) {
      var remaining = endPlanet.getUnits() - armySize;
      if ( remaining < 0 ) {
        endPlanet.setUnits( Math.abs(remaining) );
        endPlanet.owner = currentUser;
      } else if ( remaining == 0 ) {
        endPlanet.setUnits( 0 );
        endPlanet.owner = null;
      } else {
        endPlanet.setUnits( remaining );
      }
    // If you own it
    } else {
      endPlanet.setUnits( endPlanet.getUnits() + armySize );
    }
    
    startPlanet.update();
    endPlanet.update();
    
    comets = [ new Comet(startPlanet.mesh.position.x, startPlanet.mesh.position.y, endPlanet.mesh.position.x, endPlanet.mesh.position.y, 60) ];
    
    

    // Clear the clicks if we fired a comet.
    clicks = [];
  }

}

function animate() {

  requestAnimationFrame( animate );

  controls.update();

  planets.forEach(function( planet ) {
    if (planet.spinning) {
      planet.mesh.rotation.x += 0.05;
      planet.mesh.rotation.y += 0.05;
      planet.mesh.material.color.set('red');
    } else {
      planet.mesh.material.color.set('yellow');
    }
  });

  comets.forEach(function( comet ) {
    comet.render();
    
  });
  
  particleSystem.update(tick);

  renderer.render( scene, camera );

}
