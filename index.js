/* eslint-env node */
'use strict';

const DeployPluginBase = require('ember-cli-deploy-plugin');

function _list(opts) {
  let AWS  = require('aws-sdk');
  let RSVP = require('rsvp');

  let accessKeyId     = opts.accessKeyId;
  let secretAccessKey = opts.secretAccessKey;
  let archivePrefix   = opts.archivePrefix;
  let prefix          = opts.prefix;
  let bucket          = opts.bucket;
  let region          = opts.region;
  let manifestKey     = opts.manifestKey

  let client = new AWS.S3({
    accessKeyId,
    secretAccessKey,
    region
  });

  let listObjects = RSVP.denodeify(client.listObjects.bind(client));
  let getObject   = RSVP.denodeify(client.getObject.bind(client));

  let revisionsResults;

  return listObjects({ Bucket: bucket, Prefix: [prefix, archivePrefix].filter(s=>!!s).join('/') })
    .then((results) => {
      revisionsResults = results;
      return getObject({ Bucket: bucket, Key: manifestKey });
    })
    .then((current) => {
      return { revisions: revisionsResults, current };
    })
    .catch(() => {
      return { revisions: revisionsResults, current: { Body: '{}'} };
    })
    .then((result) => {
      if (result.revisions.length < 1) {
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
        let match = d.Key.match(new RegExp(archivePrefix+'([^.]*)\\.zip'));
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

        manifestKey: 'fastboot-deploy-info.json'
      },

      requiredConfig: ['bucket', 'region'],

      activate: function(/* context */) {
        let revisionKey   = this.readConfig('revisionKey');
        let bucket        = this.readConfig('bucket');
        let prefix        = this.readConfig('prefix');
        let archivePrefix = this.readConfig('archivePrefix');

        let archivePath = [prefix, archivePrefix].filter(s=>!!s).join('/')

        // update manifest-file to point to passed revision
        let downloaderManifestContent = this.readConfig('downloaderManifestContent');

        let manifest        = downloaderManifestContent(bucket, `${archivePath}${revisionKey}.zip`);
        let AWS             = require('aws-sdk');
        let RSVP            = require('rsvp');
        let accessKeyId     = this.readConfig('accessKeyId');
        let secretAccessKey = this.readConfig('secretAccessKey');
        let region          = this.readConfig('region');
        let manifestKey     = this.readConfig('manifestKey');

        let client = new AWS.S3({
          accessKeyId,
          secretAccessKey,
          region
        });
        let putObject = RSVP.denodeify(client.putObject.bind(client));

        return putObject({
          Bucket: bucket,
          Key: [prefix, manifestKey].filter(s=>!!s).join('/'),
          Body: manifest,
          ACL: 'public-read'
        });
      },

      upload: function(context) {
        let AWS = require('aws-sdk');
        let RSVP = require('rsvp');
        let fs = require('fs');

        let accessKeyId     = this.readConfig('accessKeyId');
        let secretAccessKey = this.readConfig('secretAccessKey');
        let bucket          = this.readConfig('bucket');
        var prefix          = this.readConfig('prefix');
        let region          = this.readConfig('region');

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
          Key: [prefix, context.fastbootArchiveName].filter(s=>!!s).join('/'),
        });
      },

      fetchRevisions: function() {
        let accessKeyId     = this.readConfig('accessKeyId');
        let secretAccessKey = this.readConfig('secretAccessKey');
        let archivePrefix   = this.readConfig('archivePrefix');
        let bucket          = this.readConfig('bucket');
        let prefix          = this.readConfig('prefix');
        let region          = this.readConfig('region');
        let manifestKey     = this.readConfig('manifestKey');

        let opts = {
          accessKeyId, secretAccessKey, archivePrefix, bucket, prefix, region, manifestKey
        };

        return _list(opts);
      },

      fetchInitialRevisions: function() {
        let accessKeyId     = this.readConfig('accessKeyId');
        let secretAccessKey = this.readConfig('secretAccessKey');
        let archivePrefix   = this.readConfig('archivePrefix');
        let bucket          = this.readConfig('bucket');
        let prefix          = this.readConfig('prefix');
        let region          = this.readConfig('region');
        let manifestKey     = this.readConfig('manifestKey');

        let opts = {
          accessKeyId, secretAccessKey, archivePrefix, bucket, prefix, region, manifestKey
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
