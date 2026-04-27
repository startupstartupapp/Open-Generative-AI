import { NextResponse } from 'next/server';

const FAL_QUEUE_BASE = 'https://queue.fal.run';

function getFalKey(request) {
    return request.headers.get('x-fal-key');
}

// POST /api/fal?action=submit&model={modelId}
//   → POST https://queue.fal.run/{modelId}
//
// GET /api/fal?action=status&model={modelId}&request_id={id}
//   → GET https://queue.fal.run/{modelId}/requests/{id}/status
//
// GET /api/fal?action=result&model={modelId}&request_id={id}
//   → GET https://queue.fal.run/{modelId}/requests/{id}

export async function POST(request) {
    const falKey = getFalKey(request);
    if (!falKey) {
        return NextResponse.json({ error: 'Missing x-fal-key header' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const model = searchParams.get('model');
    if (!model) {
        return NextResponse.json({ error: 'Missing model query param' }, { status: 400 });
    }

    const targetUrl = `${FAL_QUEUE_BASE}/${model}`;
    const body = await request.arrayBuffer();

    try {
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Key ${falKey}`,
            },
            body,
        });
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (err) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

export async function GET(request) {
    const falKey = getFalKey(request);
    if (!falKey) {
        return NextResponse.json({ error: 'Missing x-fal-key header' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const model = searchParams.get('model');
    const requestId = searchParams.get('request_id');
    const action = searchParams.get('action'); // 'status' or 'result'

    if (!model || !requestId) {
        return NextResponse.json({ error: 'Missing model or request_id query params' }, { status: 400 });
    }

    const path = action === 'status'
        ? `${model}/requests/${requestId}/status`
        : `${model}/requests/${requestId}`;

    const targetUrl = `${FAL_QUEUE_BASE}/${path}`;

    try {
        const response = await fetch(targetUrl, {
            headers: { 'Authorization': `Key ${falKey}` },
        });
        const data = await response.json();
        return NextResponse.json(data, { status: response.status });
    } catch (err) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
