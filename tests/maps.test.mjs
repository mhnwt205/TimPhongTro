import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseGooglePoint,mapEmbed,validPoint} from '../apps/shared/maps.ts';
test('Google point parser accepts shared coordinates and prioritizes place pin over camera',()=>{assert.deepEqual(parseGooglePoint('https://www.google.com/maps/place/room/@10,106,15z/data=!3d10.8!4d106.7'),{lat:10.8,lng:106.7});assert.deepEqual(parseGooglePoint('https://www.google.com/maps/search/?api=1&query=10.8,106.7'),{lat:10.8,lng:106.7});});
test('map input rejects spoofed domains, invalid ranges and unresolvable short links',()=>{for(const url of ['https://google.com.evil.test/maps/@10,106,15z','javascript:alert(1)','https://maps.app.goo.gl/test','https://www.google.com/maps?q=91,106'])assert.equal(parseGooglePoint(url),null);assert.equal(validPoint({lat:Infinity,lng:106}),false);const url=new URL(mapEmbed('<script>& query'));assert.equal(url.hostname,'maps.google.com');assert.equal(url.searchParams.get('q'),'<script>& query');});
