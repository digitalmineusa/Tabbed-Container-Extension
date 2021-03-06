define(['qlik', 'qvangular', 'angular'], function(qlik, qva, angular){

    var $injector = angular.injector(['ng']);
    var Promise = $injector.get('$q');
    var initialDataFetch = [{qTop: 0, qWidth: 20, qLeft: 0, qHeight: 500}];


    qva.service('qlikService', function(){
        var service = {};

        service.getAllDataRows = getAllDataRows;
        service.getAllStackedDataRows = getAllStackedDataRows;
        service.getAllPivotDataRows = getAllPivotDataRows;
        service.getObjectMetadata = getObjectMetadata;

        function getAllDataRows(model) {
            var qTotalData = [];
            var deferred = Promise.defer();

            if(model.layout.qHyperCube == null) { return deferred.resolve(qTotalData); }

            model.getHyperCubeData('/qHyperCubeDef', initialDataFetch).then(function(data){
                var columns = model.layout.qHyperCube.qSize.qcx;
                var totalHeight = model.layout.qHyperCube.qSize.qcy;
                var pageHeight = Math.floor(10000 / columns);
                var numberOfPages = Math.ceil(totalHeight / pageHeight);
                var dataHeaders = getHeaders(model);

                if (numberOfPages === 1) {
                    (data.qDataPages) ? deferred.resolve(dataHeaders.concat(data.qDataPages[0].qMatrix))
                        : deferred.resolve(dataHeaders.concat(data[0].qMatrix));
                } else {
                    var promises = Array.apply(null, new Array(numberOfPages)).map(function (data, index) {
                        return model.getHyperCubeData('/qHyperCubeDef', [getNextPage(pageHeight,index, columns)]);
                    }, this);
                    Promise.all(promises).then(function(data){
                        for (var j = 0; j < data.length; j++) {
                            if (data[j].qDataPages) {
                                for (var k1 = 0; k1 < data[j].qDataPages[0].qMatrix.length; k1++) {
                                  qTotalData.push(data[j].qDataPages[0].qMatrix[k1]);
                                }
                            } else {
                                for (var k2 = 0; k2 < data[j][0].qMatrix.length; k2++) {
                                  qTotalData.push(data[j][0].qMatrix[k2]);
                                }
                            }
                        }
                        deferred.resolve(dataHeaders.concat(qTotalData));
                    })
                }
            })
            return deferred.promise;
        }

        function getAllStackedDataRows(model) {
            var deferred = Promise.defer();

            if(model.layout.qHyperCube == null) { return deferred.resolve(qTotalData); }

            model.getHyperCubeStackData('/qHyperCubeDef', initialDataFetch).then(function(data) {
                var dataHeaders = getHeaders(model);
                var qMatrix = buildStackedMatrix([], [], data[0].qData[0]);

                deferred.resolve(dataHeaders.concat(qMatrix));
            })
            return deferred.promise;
        }

        function getAllPivotDataRows(model) {
            var deferred = Promise.defer();

            model.getHyperCubePivotData('/qHyperCubeDef', initialDataFetch).then(function(data) {
                var headers = getPivotHeaders(model, data[0].qTop);
                var partialMatrix = getPivotDimensionRows([], [], data[0].qLeft);

                headers = adjustHeaders(headers, partialMatrix);
                partialMatrix = adjustPartialMatrix(partialMatrix);

                var qMatrix = buildPivotMatrix(partialMatrix, data[0].qData);

                deferred.resolve(headers.concat(qMatrix));
            })
            return deferred.promise;
        }

        function getObjectMetadata(app, objectId) {
            var deferred = Promise.defer();
            var metadata = { Dimensions: [], Measures: [] }

            app.getObject(objectId).then(function(model){
                if(model.layout.qHyperCube == undefined) {
                    deferred.resolve();
                } else {
                    metadata.Dimensions = model.layout.qHyperCube.qDimensionInfo.map(function(o){
                        return o.qFallbackTitle == null || o.qFallbackTitle.length <= 1 ?
                            o.qGroupFieldDefs[0] : o.qFallbackTitle;
                    });

                    metadata.Measures = model.layout.qHyperCube.qMeasureInfo.map(function(o){
                        return o.qFallbackTitle == null || o.qFallbackTitle.length <= 1 ?
                            o.qAttrExprInfo[0].qFallbackTitle : o.qFallbackTitle;
                    });

                    deferred.resolve(metadata);
                }
            });
            return deferred.promise;
        }

        return service;
    });

    /** PRIVATE FUNCTIONS */
    function getNextPage(pageHeight, index, columns){
        return {
            qTop: (pageHeight * index) + index,
            qLeft: 0,
            qWidth: columns,
            qHeight: pageHeight,
            index: index
        }
    }

    function getHeaders(model) {
        var dimensions = model.layout.qHyperCube.qDimensionInfo;
        var measures = model.layout.qHyperCube.qMeasureInfo;

        dimensions = dimensions.map(function(dim){ return { qText: dim.qFallbackTitle }; })
        measures = measures.map(function(measure){ return { qText: measure.qFallbackTitle }; })

        return [ dimensions.concat(measures) ];
    }

    function getPivotHeaders(model, pivotMeasures){
        var dimensions = model.layout.qHyperCube.qDimensionInfo;
        var measures = pivotMeasures;

        dimensions = dimensions.map(function(dim){ return { qText: dim.qFallbackTitle, qType: 'dimension' }; })
        measures = measures.map(function(measure) { return { qText: measure.qText, qType: 'measure' }; })

        return [ dimensions.concat(measures) ];
    }

    function getPivotDimensionRows(matrix, row, data){
        for(var i=0; i<data.length; i++) {
            var current = data[i];
            var newRow = row.concat({ qText: current.qText })

            if(current.qSubNodes != null && current.qSubNodes.length > 0 && current.qSubNodes[0].qType !== 'E' ) {
                getPivotDimensionRows(matrix, newRow, current.qSubNodes);
            } else {
                matrix.push(newRow);
                getPivotDimensionRows(matrix, [], current);
            }
        }

        return matrix;
    }

    function adjustPartialMatrix(partialMatrix){
        var maxWidth = 0;

        partialMatrix.forEach(function(elem){
            if(elem.length > maxWidth) { maxWidth = elem.length; }
        });

        partialMatrix.forEach(function(elem) {
            if(elem.length < maxWidth) {
                for(var i=elem.length; i<maxWidth; i++) {
                    elem[i] = { qText: '' };
                }
            }
        });
        return partialMatrix;
    }

    function adjustHeaders(headers, partialMatrix) {
        var maxWidth = 0;
        var dimensions = headers[0].filter(function(o) { return o.qType === 'dimension'; })
        var measures = headers[0].filter(function(o) { return o.qType === 'measure'; })

        partialMatrix.forEach(function(elem){
            if(elem.length > maxWidth) { maxWidth = elem.length; }
        });

        return [ dimensions.splice(0, maxWidth).concat(measures) ];
    }

    function buildPivotMatrix(partialMatrix, tableData) {
        var matrix = [];

        for(var i=0; i<partialMatrix.length; i++) {
            matrix.push(partialMatrix[i].concat(tableData[i]))
        }

        return matrix;
    }

    function buildStackedMatrix(matrix, row, data) {
        for(var i=0; i<data.qSubNodes.length; i++) {
            var subnode = data.qSubNodes[i];
            var newRow = row.concat([subnode]);

            if(subnode.qSubNodes != null && subnode.qSubNodes.length > 0) {
                buildStackedMatrix(matrix, newRow, subnode);
            } else {
                matrix.push(newRow);
                buildStackedMatrix(matrix, [], subnode);
            }
        }

        return matrix;
    }
})
