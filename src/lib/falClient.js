import {
    getModelById,
    getVideoModelById,
    getI2IModelById,
    getI2VModelById,
    getLipSyncModelById,
} from './models.js';

const FAL_PROXY = '/api/fal';

function arToImageSize(ar) {
    switch (ar) {
        case '16:9':  return { width: 1280, height: 720 };
        case '9:16':  return { width: 720,  height: 1280 };
        case '4:3':   return { width: 1024, height: 768 };
        case '3:4':   return { width: 768,  height: 1024 };
        case '3:2':   return { width: 1152, height: 768 };
        case '2:3':   return { width: 768,  height: 1152 };
        case '21:9':  return { width: 1536, height: 640 };
        default:      return { width: 1024, height: 1024 }; // 1:1
    }
}

export class FalClient {
    getFalKey() {
        const key = localStorage.getItem('fal_key');
        if (!key) throw new Error('Fal.ai API Key missing. Please add it in Settings.');
        return key;
    }

    async _submit(modelEndpoint, payload, falKey) {
        const url = `${FAL_PROXY}?action=submit&model=${encodeURIComponent(modelEndpoint)}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-fal-key': falKey,
            },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Fal submit failed [${response.status}]: ${text.slice(0, 200)}`);
        }
        return response.json();
    }

    async _pollStatus(modelEndpoint, requestId, falKey) {
        const url = `${FAL_PROXY}?action=status&model=${encodeURIComponent(modelEndpoint)}&request_id=${requestId}`;
        const response = await fetch(url, { headers: { 'x-fal-key': falKey } });
        if (!response.ok) throw new Error(`Fal status check failed [${response.status}]`);
        return response.json();
    }

    async _getResult(modelEndpoint, requestId, falKey) {
        const url = `${FAL_PROXY}?action=result&model=${encodeURIComponent(modelEndpoint)}&request_id=${requestId}`;
        const response = await fetch(url, { headers: { 'x-fal-key': falKey } });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Fal result fetch failed [${response.status}]: ${text.slice(0, 200)}`);
        }
        return response.json();
    }

    async _waitForResult(modelEndpoint, requestId, falKey, maxAttempts = 120, interval = 3000) {
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            await new Promise(r => setTimeout(r, interval));
            console.log(`[Fal] Poll ${attempt}/${maxAttempts} requestId=${requestId}`);
            const status = await this._pollStatus(modelEndpoint, requestId, falKey);
            console.log('[Fal] Status:', status.status);
            if (status.status === 'COMPLETED') return this._getResult(modelEndpoint, requestId, falKey);
            if (status.status === 'FAILED') throw new Error(`Fal generation failed: ${status.error || 'Unknown error'}`);
        }
        throw new Error('Fal generation timed out after polling.');
    }

    async generateImage(params) {
        const falKey = this.getFalKey();
        const modelInfo = getModelById(params.model);
        const endpoint = modelInfo?.endpoint || params.model;

        const payload = {
            prompt: params.prompt || '',
            num_images: params.num_images ?? 1,
        };
        if (modelInfo?.usesAspectRatioString) {
            if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
        } else {
            payload.image_size = arToImageSize(params.aspect_ratio);
        }
        if (params.seed && params.seed !== -1) payload.seed = params.seed;
        if (params.image_url) payload.image_url = params.image_url;
        if (params.negative_prompt) payload.negative_prompt = params.negative_prompt;
        if (params.num_inference_steps != null) payload.num_inference_steps = params.num_inference_steps;
        if (params.guidance_scale != null) payload.guidance_scale = params.guidance_scale;
        if (params.safety_tolerance != null) payload.safety_tolerance = params.safety_tolerance;
        if (params.resolution) payload.resolution = params.resolution;
        if (params.style) payload.style = params.style;
        if (params.style_type) payload.style_type = params.style_type;
        if (params.quality) payload.quality = params.quality;
        if (params.output_format) payload.output_format = params.output_format;

        console.log('[Fal] generateImage:', endpoint, payload);
        const submitData = await this._submit(endpoint, payload, falKey);
        console.log('[Fal] submit response:', submitData);

        const requestId = submitData.request_id;
        if (!requestId) {
            const imageUrl = submitData.images?.[0]?.url || submitData.data?.images?.[0]?.url;
            return { ...submitData, url: imageUrl };
        }

        if (params.onRequestId) params.onRequestId(requestId);
        const result = await this._waitForResult(endpoint, requestId, falKey, 60, 2000);
        const imageUrl = result.images?.[0]?.url || result.data?.images?.[0]?.url;
        console.log('[Fal] Image URL:', imageUrl);
        return { ...result, url: imageUrl };
    }

    async generateI2I(params) {
        const falKey = this.getFalKey();
        const modelInfo = getI2IModelById(params.model);
        const endpoint = modelInfo?.endpoint || params.model;

        const imageField = modelInfo?.imageField || 'image_url';
        const payload = { prompt: params.prompt || '' };
        const imagesList = params.images_list?.length > 0
            ? params.images_list
            : (params.image_url ? [params.image_url] : null);
        if (imagesList) {
            if (imageField === 'images_list') payload.images_list = imagesList;
            else payload[imageField] = imagesList[0];
        }
        if (params.aspect_ratio) payload.image_size = arToImageSize(params.aspect_ratio);

        console.log('[Fal] generateI2I:', endpoint, payload);
        const submitData = await this._submit(endpoint, payload, falKey);

        const requestId = submitData.request_id;
        if (!requestId) {
            const imageUrl = submitData.images?.[0]?.url || submitData.data?.images?.[0]?.url;
            return { ...submitData, url: imageUrl };
        }

        if (params.onRequestId) params.onRequestId(requestId);
        const result = await this._waitForResult(endpoint, requestId, falKey, 60, 2000);
        const imageUrl = result.images?.[0]?.url || result.data?.images?.[0]?.url;
        return { ...result, url: imageUrl };
    }

    async generateVideo(params) {
        const falKey = this.getFalKey();
        const modelInfo = getVideoModelById(params.model);
        const endpoint = modelInfo?.endpoint || params.model;

        const payload = {};
        if (params.prompt) payload.prompt = params.prompt;
        if (params.negative_prompt) payload.negative_prompt = params.negative_prompt;
        if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
        if (params.duration) payload.duration = params.duration;
        if (params.resolution) payload.resolution = params.resolution;
        if (params.cfg_scale != null) payload.cfg_scale = params.cfg_scale;
        if (params.generate_audio != null) payload.generate_audio = params.generate_audio;
        if (params.safety_tolerance != null) payload.safety_tolerance = params.safety_tolerance;
        if (params.seed && params.seed !== -1) payload.seed = params.seed;

        console.log('[Fal] generateVideo:', endpoint, payload);
        const submitData = await this._submit(endpoint, payload, falKey);
        console.log('[Fal] video submit:', submitData);

        const requestId = submitData.request_id;
        if (!requestId) {
            const videoUrl = submitData.video?.url || submitData.data?.video?.url;
            return { ...submitData, url: videoUrl };
        }

        if (params.onRequestId) params.onRequestId(requestId);
        const result = await this._waitForResult(endpoint, requestId, falKey, 900, 3000);
        const videoUrl = result.video?.url || result.data?.video?.url;
        console.log('[Fal] Video URL:', videoUrl);
        return { ...result, url: videoUrl };
    }

    async generateI2V(params) {
        const falKey = this.getFalKey();
        const modelInfo = getI2VModelById(params.model);
        const endpoint = modelInfo?.endpoint || params.model;

        const imageField = modelInfo?.imageField || 'image_url';
        const payload = {};
        if (params.prompt) payload.prompt = params.prompt;
        if (params.negative_prompt) payload.negative_prompt = params.negative_prompt;
        if (params.image_url) {
            if (imageField === 'images_list') payload.images_list = [params.image_url];
            else payload[imageField] = params.image_url;
        }
        if (params.aspect_ratio) payload.aspect_ratio = params.aspect_ratio;
        if (params.duration) payload.duration = params.duration;
        if (params.resolution) payload.resolution = params.resolution;
        if (params.cfg_scale != null) payload.cfg_scale = params.cfg_scale;
        if (params.quality) payload.quality = params.quality;
        if (params.motion_mode) payload.motion_mode = params.motion_mode;
        if (params.shot_type) payload.shot_type = params.shot_type;
        if (params.generate_audio != null) payload.generate_audio = params.generate_audio;
        if (params.safety_tolerance != null) payload.safety_tolerance = params.safety_tolerance;
        if (params.seed && params.seed !== -1) payload.seed = params.seed;

        console.log('[Fal] generateI2V:', endpoint, payload);
        const submitData = await this._submit(endpoint, payload, falKey);

        const requestId = submitData.request_id;
        if (!requestId) {
            const videoUrl = submitData.video?.url || submitData.data?.video?.url;
            return { ...submitData, url: videoUrl };
        }

        if (params.onRequestId) params.onRequestId(requestId);
        const result = await this._waitForResult(endpoint, requestId, falKey, 900, 3000);
        const videoUrl = result.video?.url || result.data?.video?.url;
        return { ...result, url: videoUrl };
    }

    async processLipSync(params) {
        const falKey = this.getFalKey();
        const modelInfo = getLipSyncModelById(params.model);
        const endpoint = modelInfo?.endpoint || params.model;

        const payload = {};
        if (params.audio_url) payload.audio_url = params.audio_url;
        if (params.image_url) payload.image_url = params.image_url;
        if (params.video_url) payload.video_url = params.video_url;
        if (params.sync_mode) payload.sync_mode = params.sync_mode;

        console.log('[Fal] processLipSync:', endpoint, payload);
        const submitData = await this._submit(endpoint, payload, falKey);

        const requestId = submitData.request_id;
        if (!requestId) {
            const videoUrl = submitData.video?.url || submitData.data?.video?.url;
            return { ...submitData, url: videoUrl };
        }

        if (params.onRequestId) params.onRequestId(requestId);
        const result = await this._waitForResult(endpoint, requestId, falKey, 900, 3000);
        const videoUrl = result.video?.url || result.data?.video?.url;
        return { ...result, url: videoUrl };
    }
}

export const falClient = new FalClient();
