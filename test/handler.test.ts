

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Unstable_DevWorker } from "wrangler";
import { unstable_dev } from "wrangler";
import { Wallet } from '@ethersproject/wallet';

const NAMESPACE = 'planet-wars';

type Params = {
  counter?: string;
  namespace?: string;
  data: string;
  invalidSignature?: boolean;
};

async function createPUT(wallet: Wallet, params: Params) {
	const dataAsString = params.data;

  const counter = params.counter || Math.floor(Date.now()).toString();
  const namespace = params.namespace || NAMESPACE;

  let signature = await wallet.signMessage('put:' + namespace + ':' + counter + ':' + dataAsString);

  if (params.invalidSignature) {
    signature = await wallet.signMessage('putInvalid:' + namespace + ':' + counter + ':' + dataAsString);
  }

  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'wallet_putString',
    params: [wallet.address, namespace, counter, dataAsString, signature],
  };
}

async function createGET( address: string,
  params?: { namespace?: string }) {
		return {
			jsonrpc: '2.0',
			id: 2,
			method: 'wallet_getString',
			params: [address, params ? params.namespace || NAMESPACE : NAMESPACE],
		};
	}


describe('handler returns response with request method', () => {
	let worker: Unstable_DevWorker;

  beforeAll(async () => {
    worker = await unstable_dev("src/index.ts", {
      experimental: { disableExperimentalWarning: true },
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  it('wallet_putString', async () => {


    const wallet = Wallet.createRandom();
    const data = JSON.stringify({ hello: 'world' });
    const putRequest = await createPUT(wallet, { data });
		{
    const response = await worker.fetch("http://unknown", {method: 'POST', body: JSON.stringify(putRequest)});
		expect(response.status).toBe(200);
		const data: any = await response.json();
		expect(data.result.success)

		}


    const getRequest = await createGET(wallet.address);

		{
		const { status, url, redirected } = await worker.fetch("http://unknown", {method: 'POST', body: JSON.stringify(getRequest)});
    expect(status).toBe(200);
		}
  });

  it('wallet_putString fails', async () => {
    const wallet = Wallet.createRandom();
    const msgData = JSON.stringify({ hello: 'world' });
		const putRequest = await createPUT(wallet, { data:msgData,  invalidSignature: true });
		const response = await worker.fetch("http://unknown", {method: 'POST', body: JSON.stringify(putRequest)});
		expect(response.status).toBe(200);
		const data: any = await response.json();
		expect(data.result).to.toBeNull();
  });
});
