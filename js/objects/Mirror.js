/**
 * @author Slayvin / http://slayvin.net
 */

v3d.Mirror = function(width, height, options) {

    v3d.Mesh.call(this, new v3d.PlaneBufferGeometry(width, height));

    var scope = this;

    scope.name = 'mirror_' + scope.id;

    options = options || {};

    var viewport = new v3d.Vector4();

    var textureWidth = options.textureWidth !== undefined ? options.textureWidth : 512;
    var textureHeight = options.textureHeight !== undefined ? options.textureHeight : 512;

    var clipBias = options.clipBias !== undefined ? options.clipBias : 0.0;
    var mirrorColor = options.color !== undefined ? new v3d.Color(options.color) : new v3d.Color(0x7F7F7F);

    var recursion = options.recursion !== undefined ? options.recursion : 0;

    //

    var mirrorPlane = new v3d.Plane();
    var normal = new v3d.Vector3();
    var mirrorWorldPosition = new v3d.Vector3();
    var cameraWorldPosition = new v3d.Vector3();
    var rotationMatrix = new v3d.Matrix4();
    var lookAtPosition = new v3d.Vector3(0, 0, - 1);
    var clipPlane = new v3d.Vector4();

    var view = new v3d.Vector3();
    var target = new v3d.Vector3();
    var q = new v3d.Vector4();

    var textureMatrix = new v3d.Matrix4();

    var mirrorCamera = new v3d.PerspectiveCamera();

    var parameters = {
        minFilter: v3d.LinearFilter,
        magFilter: v3d.LinearFilter,
        format: v3d.RGBFormat,
        stencilBuffer: false
    };

    var renderTarget = new v3d.WebGLRenderTarget(textureWidth, textureHeight, parameters);

    if (! v3d.Math.isPowerOfTwo(textureWidth) || ! v3d.Math.isPowerOfTwo(textureHeight)) {

        renderTarget.texture.generateMipmaps = false;

    }

    var mirrorShader = {

        uniforms: {
            mirrorColor: { value: new v3d.Color(0x7F7F7F) },
            mirrorSampler: { value: null },
            textureMatrix: { value: new v3d.Matrix4() }
        },

        vertexShader: [
            'uniform mat4 textureMatrix;',
            'varying vec4 mirrorCoord;',

            'void main() {',

            '    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
            '    vec4 worldPosition = modelMatrix * vec4(position, 1.0);',
            '    mirrorCoord = textureMatrix * worldPosition;',

            '    gl_Position = projectionMatrix * mvPosition;',

            '}'
        ].join('\n'),

        fragmentShader: [
            'uniform vec3 mirrorColor;',
            'uniform sampler2D mirrorSampler;',
            'varying vec4 mirrorCoord;',

            'float blendOverlay(float base, float blend) {',
            '    return(base < 0.5 ? (2.0 * base * blend) : (1.0 - 2.0 * (1.0 - base) * (1.0 - blend)));',
            '}',

            'void main() {',
            '    vec4 color = texture2DProj(mirrorSampler, mirrorCoord);',
            '    color = vec4(blendOverlay(mirrorColor.r, color.r), blendOverlay(mirrorColor.g, color.g), blendOverlay(mirrorColor.b, color.b), 1.0);',
            '    gl_FragColor = color;',
            '}'
        ].join('\n')

    };

    var mirrorUniforms = v3d.UniformsUtils.clone(mirrorShader.uniforms);

    var material = new v3d.ShaderMaterial({

        fragmentShader: mirrorShader.fragmentShader,
        vertexShader: mirrorShader.vertexShader,
        uniforms: mirrorUniforms

    });

    material.uniforms.mirrorSampler.value = renderTarget.texture;
    material.uniforms.mirrorColor.value = mirrorColor;
    material.uniforms.textureMatrix.value = textureMatrix;

    scope.material = material;

    scope.onBeforeRender = function(renderer, scene, camera) {

        if ('recursion' in camera.userData) {

            if (camera.userData.recursion === recursion) return;

            camera.userData.recursion ++;

        }

        mirrorWorldPosition.setFromMatrixPosition(scope.matrixWorld);
        cameraWorldPosition.setFromMatrixPosition(camera.matrixWorld);

        rotationMatrix.extractRotation(scope.matrixWorld);

        normal.set(0, 0, 1);
        normal.applyMatrix4(rotationMatrix);

        view.subVectors(mirrorWorldPosition, cameraWorldPosition);

        // Avoid rendering when mirror is facing away

        if (view.dot(normal) > 0) return;

        view.reflect(normal).negate();
        view.add(mirrorWorldPosition);

        rotationMatrix.extractRotation(camera.matrixWorld);

        lookAtPosition.set(0, 0, - 1);
        lookAtPosition.applyMatrix4(rotationMatrix);
        lookAtPosition.add(cameraWorldPosition);

        target.subVectors(mirrorWorldPosition, lookAtPosition);
        target.reflect(normal).negate();
        target.add(mirrorWorldPosition);

        mirrorCamera.position.copy(view);
        mirrorCamera.up.set(0, 1, 0);
        mirrorCamera.up.applyMatrix4(rotationMatrix);
        mirrorCamera.up.reflect(normal);
        mirrorCamera.lookAt(target);

        mirrorCamera.far = camera.far; // Used in WebGLBackground

        mirrorCamera.updateMatrixWorld();
        mirrorCamera.projectionMatrix.copy(camera.projectionMatrix);

        mirrorCamera.userData.recursion = 0;

        // Update the texture matrix
        textureMatrix.set(
            0.5, 0.0, 0.0, 0.5,
            0.0, 0.5, 0.0, 0.5,
            0.0, 0.0, 0.5, 0.5,
            0.0, 0.0, 0.0, 1.0
        );
        textureMatrix.multiply(mirrorCamera.projectionMatrix);
        textureMatrix.multiply(mirrorCamera.matrixWorldInverse);

        // Now update projection matrix with new clip plane, implementing code from: http://www.terathon.com/code/oblique.html
        // Paper explaining this technique: http://www.terathon.com/lengyel/Lengyel-Oblique.pdf
        mirrorPlane.setFromNormalAndCoplanarPoint(normal, mirrorWorldPosition);
        mirrorPlane.applyMatrix4(mirrorCamera.matrixWorldInverse);

        clipPlane.set(mirrorPlane.normal.x, mirrorPlane.normal.y, mirrorPlane.normal.z, mirrorPlane.constant);

        var projectionMatrix = mirrorCamera.projectionMatrix;

        q.x = (Math.sign(clipPlane.x) + projectionMatrix.elements[8]) / projectionMatrix.elements[0];
        q.y = (Math.sign(clipPlane.y) + projectionMatrix.elements[9]) / projectionMatrix.elements[5];
        q.z = - 1.0;
        q.w = (1.0 + projectionMatrix.elements[10]) / projectionMatrix.elements[14];

        // Calculate the scaled plane vector
        clipPlane.multiplyScalar(2.0 / clipPlane.dot(q));

        // Replacing the third row of the projection matrix
        projectionMatrix.elements[2] = clipPlane.x;
        projectionMatrix.elements[6] = clipPlane.y;
        projectionMatrix.elements[10] = clipPlane.z + 1.0 - clipBias;
        projectionMatrix.elements[14] = clipPlane.w;

        // Render

        scope.visible = false;

        var currentRenderTarget = renderer.getRenderTarget();

        var currentVrEnabled = renderer.vr.enabled;
        var currentShadowAutoUpdate = renderer.shadowMap.autoUpdate;

        renderer.vr.enabled = false; // Avoid camera modification and recursion
        renderer.shadowMap.autoUpdate = false; // Avoid re-computing shadows

        renderer.render(scene, mirrorCamera, renderTarget, true);

        renderer.vr.enabled = currentVrEnabled;
        renderer.shadowMap.autoUpdate = currentShadowAutoUpdate;

        renderer.setRenderTarget(currentRenderTarget);

        // Restore viewport

        var bounds = camera.bounds;

        if (bounds !== undefined) {

            var size = renderer.getSize();
            var pixelRatio = renderer.getPixelRatio();

            viewport.x = bounds.x * size.width * pixelRatio;
            viewport.y = bounds.y * size.height * pixelRatio;
            viewport.z = bounds.z * size.width * pixelRatio;
            viewport.w = bounds.w * size.height * pixelRatio;

            renderer.state.viewport(viewport);

        }

        scope.visible = true;

    };

};

v3d.Mirror.prototype = Object.create(v3d.Mesh.prototype);
v3d.Mirror.prototype.constructor = v3d.Mirror;
