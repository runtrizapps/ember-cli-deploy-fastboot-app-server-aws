/* eslint-env node */
'use strict';

const DeployPluginBase = require('ember-cli-deploy-plugin');

function _list(opts) {
  let AWS  = require('aws-sdk');
  let RSVP = require('rsvp');

  let accessKeyId        = opts.accessKeyId;
  let secretAccessKey    = opts.secretAccessKey;
  let fastbootS3Prefix   = opts.fastbootS3Prefix;
  let bucket             = opts.bucket;
  let region             = opts.region;
  let fastbootS3Manifest = opts.fastbootS3Manifest

  let client = new AWS.S3({
    accessKeyId,
    secretAccessKey,
    region
  });

  let listObjects = RSVP.denodeify(client.listObjects.bind(client));
  let getObject   = RSVP.denodeify(client.getObject.bind(client));

  let revisionsResults;
  return listObjects({ Bucket: bucket, Prefix: fastbootS3Prefix })
    .then((results) => {
      revisionsResults = results;
      return getObject({ Bucket: bucket, Key: fastbootS3Manifest });
    })
    .then((current) => {
      return { revisions: revisionsResults, current };
    })
    .catch(() => {
      return { revisions: revisionsResults, current: { Body: '{}'} };
    })
    .then((result) => {
      if (!result.revisions || result.revisions.length < 1) {
        return { revisions: [] };
      }

      let revisionsData = result.revisions;
      let current = result.current;
      let data = revisionsData.Contents;
      let body = current.Body;

      let manifestData = JSON.parse(body);

      let revisions = data.sort(function(a, b) {
        return new Date(b.LastModified) - new Date(a.LastModified);
      })
      .map((d) => {
        let match = d.Key.match(new RegExp(fastbootS3Prefix+'([^.]*)\\.zip'));
        if (!match) {
          return; // ignore files that are no zipped app builds
        }

        let revision = match[1];
        return {
          revision,
          timestamp: d.LastModified,
          active: d.Key === manifestData.key
        }
      }).filter((d) => d); // filter out empty values

      return { revisions };
    });
}

module.exports = {
  name: 'ember-cli-deploy-fastboot-app-server-aws',

  createDeployPlugin: function(options) {
    let DeployPlugin = DeployPluginBase.extend({
      name: options.name,

      defaultConfig: {
        archivePrefix: function(context) {
          return context.fastbootArchivePrefix;
        },

        revisionKey: function(context) {
          let revisionKey = context.revisionData && context.revisionData.revisionKey;
          return context.commandOptions.revision || revisionKey;
        },

        downloaderManifestContent: function(context) {
          // setup via ember-cli-deploy-fastboot-app-server plugin
          return context.fastbootDownloaderManifestContent;
        },

        manifestKey: 'fastboot-deploy-info.json',

        activateZip: false,
        activateManifest: true,
      },

      requiredConfig: ['bucket', 'region'],

      setup: function() {
        let archivePrefix        = this.readConfig('archivePrefix');
        let prefix               = this.readConfig('prefix');
        let manifestKey          = this.readConfig('manifestKey');

        let fastbootS3Prefix     = [prefix, archivePrefix]
          .filter(p => !!p)
          .join('/');

        let fastbootS3Manifest   = [prefix, manifestKey]
          .filter(p => !!p)
          .join('/');

        return { fastbootS3Prefix, fastbootS3Manifest };
      },

      activate: function(context) {
        let revisionKey   = this.readConfig('revisionKey');
        let bucket        = this.readConfig('bucket');
        let activateZip   = this.readConfig('activateZip');
        let activateManifest = this.readConfig('activateManifest');
        let promises      = [];

        // update manifest-file to point to passed revision
        let downloaderManifestContent = this.readConfig('downloaderManifestContent');
        let manifest        = downloaderManifestContent(bucket, `${context.fastbootS3Prefix}${revisionKey}.zip`);
        let AWS             = require('aws-sdk');
        let RSVP            = require('rsvp');
        let accessKeyId     = this.readConfig('accessKeyId');
        let secretAccessKey = this.readConfig('secretAccessKey');
        let region          = this.readConfig('region');

        let client = new AWS.S3({
          accessKeyId,
          secretAccessKey,
          region
        });

        if (activateManifest) {
          let putObject = RSVP.denodeify(client.putObject.bind(client));

          promises.push(putObject({
            Bucket: bucket,
            Key: context.fastbootS3Manifest,
            Body: manifest,
            ACL: 'public-read'
          }));
        }

        if (activateZip) {
          let copyObject = RSVP.denodeify(client.copyObject.bind(client));

          promises.push(copyObject({
            Bucket: bucket,
            CopySource: `${bucket}/${context.fastbootS3Prefix}${revisionKey}.zip`,
            Key: context.fastbootS3Prefix.replace(/-$/, '.zip'),
            ACL: 'public-read'
          }));
        }

        return RSVP.all(promises);
      },

      upload: function(context) {
        let AWS = require('aws-sdk');
        let RSVP = require('rsvp');
        let fs = require('fs');

        let accessKeyId     = this.readConfig('accessKeyId');
        let secretAccessKey = this.readConfig('secretAccessKey');
        let bucket          = this.readConfig('bucket');
        let region          = this.readConfig('region');
        let revisionKey   = this.readConfig('revisionKey');

        let client = new AWS.S3({
          accessKeyId,
          secretAccessKey,
          region
        });

        let putObject = RSVP.denodeify(client.putObject.bind(client));

        let data = fs.readFileSync(context.fastbootArchivePath);

        return putObject({
          Bucket: bucket,
          Body: data,
          Key: `${context.fastbootS3Prefix}${revisionKey}.zip`,
        });
      },

      fetchRevisions: function(context) {
        let accessKeyId     = this.readConfig('accessKeyId');
        let secretAccessKey = this.readConfig('secretAccessKey');
        let bucket          = this.readConfig('bucket');
        let region          = this.readConfig('region');
        let fastbootS3Prefix = context.fastbootS3Prefix;
        let fastbootS3Manifest = context.fastbootS3Manifest;

        let opts = {
          accessKeyId, secretAccessKey, bucket, region, fastbootS3Manifest, fastbootS3Prefix
        };

        return _list(opts);
      },

      fetchInitialRevisions: function(context) {
        let accessKeyId     = this.readConfig('accessKeyId');
        let secretAccessKey = this.readConfig('secretAccessKey');
        let bucket          = this.readConfig('bucket');
        let region          = this.readConfig('region');
        let fastbootS3Prefix = context.fastbootS3Prefix;
        let fastbootS3Manifest = context.fastbootS3Manifest;

        let opts = {
          accessKeyId, secretAccessKey, bucket, region, fastbootS3Manifest, fastbootS3Prefix
        };

        return _list(opts)
          .then((data) => {
            return { initialRevisions: data.revisions };
          });
      }
    });

    return new DeployPlugin();
  }
};
