import { refuse } from "./errors.js";
import { safeName } from "./names.js";
/** Used when a body has no colour. */
export const DEFAULT_COLOR = "#cccccc";
export const MATERIAL_METALLIC = 0;
export const MATERIAL_ROUGHNESS = 0.8;
function srgbToLinear(value) {
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function linearToSrgb(value) {
    return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}
/**
 * Reads a colour and returns it as sRGB bytes. Colours are kept at eight bits per channel, so
 * a material name and its colour always match one to one.
 */
export function colorBytes(color, colorSpace, bodyName) {
    const input = color ?? DEFAULT_COLOR;
    if (typeof input === "string") {
        const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim())?.[1];
        if (hex === undefined) {
            refuse("BAD_COLOR", `Body "${bodyName}": colour "${input}" is not "#rrggbb" or "#rgb". Transparency is not supported.`);
        }
        const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
        return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16));
    }
    if (!Array.isArray(input) || input.length !== 3 || !input.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 1)) {
        refuse("BAD_COLOR", `Body "${bodyName}": colour must be a hex string or [r, g, b] with each channel from 0 to 1.`);
    }
    return input.map((channel) => Math.round((colorSpace === "linear" ? linearToSrgb(channel) : channel) * 255));
}
function hexOf(bytes) {
    return bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
/**
 * One material per distinct colour, in the order bodies first use them. A body that names its
 * material gets a material of that name; two bodies may share a name only with the same colour.
 */
export function buildMaterials(bodies, colorSpace) {
    const materials = [];
    const slotByName = new Map();
    const slotOfBody = bodies.map((body) => {
        const bytes = colorBytes(body.color, colorSpace, body.name);
        const hex = hexOf(bytes);
        if (body.materialName !== undefined && (typeof body.materialName !== "string" || body.materialName.trim() === "")) {
            refuse("BAD_NAME", `Body "${body.name}": materialName must be a string with at least one character.`);
        }
        const name = body.materialName === undefined ? `color_${hex}` : safeName(body.materialName, "material");
        const existing = slotByName.get(name);
        if (existing !== undefined) {
            const material = materials[existing];
            if (material.color !== `#${hex}`) {
                refuse("MATERIAL_CONFLICT", `Material "${name}" is used with two colours, ${material.color} and #${hex} (body "${body.name}"). Give each colour its own material name.`);
            }
            material.bodies += 1;
            return existing;
        }
        const linear = bytes.map((byte) => Math.round(srgbToLinear(byte / 255) * 1e6) / 1e6);
        materials.push({ name, color: `#${hex}`, baseColorFactor: [linear[0], linear[1], linear[2], 1], bodies: 1 });
        slotByName.set(name, materials.length - 1);
        return materials.length - 1;
    });
    return { materials, slotOfBody };
}
