import { NormalBlending, ShaderMaterial, ShaderMaterialParameters } from '@iwsdk/core';

/**
 * Cheap light. Shaders write premultiplied colour, and their alpha says how
 * much of what is behind gets dimmed. Low alpha with bright colour reads as
 * glow, in passthrough too, without any post-processing pass.
 */
export function lightMaterial(
  parameters: ShaderMaterialParameters,
): ShaderMaterial {
  return new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    premultipliedAlpha: true,
    toneMapped: false,
    ...parameters,
  });
}
