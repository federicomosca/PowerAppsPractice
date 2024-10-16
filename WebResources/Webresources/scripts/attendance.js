﻿const FM = FM || {};
FM.MDP = FM.MDP || {};
FM.MDP.ATTENDANCE = FM.MDP.ATTENDANCE || {};

(() => {
    const _self = this;
    
    _self.formModel = {
        entity: {
            logicalName: "account",
            displayName: "Organizzazione",
        },
        fields: {
            code: "res_code",
            createdOn: "createdon",
            lesson: "res_classroombooking",
            subscriber: "res_subscriberid",
            date: "res_date",
            startingTime: "res_startingtime",
            endingTime: "res_endingtime",
            signature: "res_signature",
            participationMode: "res_participationmode"
        },
        tabs: {},
        sections: {}
    };

    const fields = _self.formModel.fields;

    _self.fillLessonRelatedFields = function (executionContext) {
        const formContext = executionContext.getFormContext();
        let date, startingTime, endingTime, alreadySet;

        const lessonField = formContext.getAttribute(fields.lesson);
        const lessonId = lessonField.getValue() ? lessonField.getValue()[0].id : null;

        const dateField = formContext.getAttribute(fields.date).getValue();
        const startingTimeField = formContext.getAttribute(fields.startingTime).getValue();
        const endingTimeField = formContext.getAttribute(fields.endingTime).getValue()

        if (dateField && startingTimeField && endingTimeField) alreadySet = true;

        if (lessonId && !alreadySet) {
            Xrm.WebApi.retrieveRecord("res_classroombooking", lessonId, "?$select=res_intendeddate,res_intendedstartingtime,res_intendedendingtime").then(
                lesson => {
                    [date, startingTime, endingTime] = [lesson["res_intendeddate"], lesson["res_intendedstartingtime"], lesson["res_intendedendingtime"]];

                    formContext.getAttribute(fields.date).setValue(new Date(date));
                    formContext.getAttribute(fields.startingTime).setValue(startingTime);
                    formContext.getAttribute(fields.endingTime).setValue(endingTime);
                },
                error => { console.log(error.message); }
            );
        }
    };

    _self.checkAvailableParticipationMode = executionContext => {
        let formContext = executionContext.getFormContext();

        const lesson = formContext.getAttribute(fields.lesson).getValue();
        const participationModeControl = formContext.getControl(fields.participationMode);
        let classroomSeats;
        let isInPersonMandatory;

        /**
         * recupero la lezione legata alla presenza, dalla lezione recupero l'aula
         * dell'aula vedo quanti sono i posti
         */
        if (lesson) {
            const lessonId = formContext.getAttribute(fields.lesson).getValue()[0].id;
            Xrm.WebApi.retrieveRecord("res_classroombooking", lessonId, "?$select=_res_classroomid_value, res_sessionmode, res_inpersonparticipation").then(
                lesson => {
                    sessionMode = lesson["res_sessionmode"];
                    isInPersonMandatory = lesson["res_inpersonparticipation"];
                    const classroomId = lesson._res_classroomid_value;

                    if (classroomId) {
                        Xrm.WebApi.retrieveRecord("res_classroom", classroomId, "?$select=res_seats").then(
                            classroom => {
                                classroomSeats = classroom.res_seats;
                                /**
                                 * recupero il numero di iscritti alla lezione attivi e in presenza
                                 */
                                var fetchXml = [
                                    "?fetchXml=<fetch returntotalrecordcount='true'>",
                                    "  <entity name='res_attendance'>",
                                    "    <filter>",
                                    "      <condition attribute='res_classroombooking' operator='eq' value='", lessonId, "'/>",
                                    "      <condition attribute='res_participationmode' operator='eq' value='1'/>",
                                    "      <condition attribute='statecode' operator='eq' value='0'/>",
                                    "    </filter>",
                                    "  </entity>",
                                    "</fetch>"
                                ].join("");

                                Xrm.WebApi.retrieveMultipleRecords("res_attendance", fetchXml).then(
                                    results => {
                                        /**
                                         * se il numero di iscritti in presenza supera il numero di posti dell'aula
                                         * tutti i nuovi iscritti vedranno solo "da remoto" nell'option set
                                         * altrimenti controllo la sessionMode dell'aula e se è in presenza controllo la partecipazione in presenza se`è obbligatoria
                                         * in quest'ultimo caso i nuovi iscritti vedranno solo "da remoto"
                                         */

                                        if (results.entities.length !== classroomSeats) {
                                            if (isInPersonMandatory) {
                                                participationModeControl.setVisible(false);
                                                formContext.getAttribute(fields.participationMode).setValue(true);
                                            }
                                            else {
                                                participationModeControl.setVisible(true);
                                                formContext.getAttribute(fields.participationMode).setValue(true);
                                            }
                                        } else {
                                            if (isInPersonMandatory) {
                                                participationModeControl.setVisible(false);
                                                formContext.getAttribute(fields.participationMode).setValue(false);
                                            } else {
                                                participationModeControl.setVisible(true);
                                            }
                                        }
                                    },
                                    error => { console.log(error.message); }
                                );
                            },
                            error => { console.log(error.message); }
                        );
                    } else {
                        participationModeControl.setVisible(false);
                    }
                },
                error => { console.log(error.message); }
            );

        } else {
            console.log('Lesson not found.');
        }
    }

    _self.onChangeParticipationMode = executionContext => {
        let formContext = executionContext.getFormContext();
        formContext.getControl(fields.participationMode).clearNotification();

        let errorMessage;
        const lesson = formContext.getAttribute(fields.lesson).getValue();
        const participationMode = formContext.getAttribute(fields.participationMode).getValue();

        if (lesson) {
            const lessonId = formContext.getAttribute(fields.lesson).getValue()[0].id;

            Xrm.WebApi.retrieveRecord("res_classroombooking", lessonId, "?$select=_res_classroomid_value, res_sessionmode, res_inpersonparticipation").then(
                lesson => {
                    const sessionMode = lesson.res_sessionmode;
                    const isInPersonMandatory = lesson.res_inpersonparticipation;
                    const classroomId = lesson._res_classroomid_value;

                    if (!sessionMode) {
                        if (participationMode)
                            errorMessage = "La lezione non è erogata in presenza";
                    } else {
                        if (isInPersonMandatory && !participationMode) {
                            errorMessage = "È obbligatoria la presenza in aula.";
                        } else {
                            Xrm.WebApi.retrieveRecord("res_classroom", classroomId, "?$select=res_seats").then(
                                classroom => {
                                    const classroomSeats = classroom.res_seats;

                                    /**
                                    * recupero il numero di iscritti alla lezione attivi e in presenza
                                    */
                                    var fetchXml = [
                                        "?fetchXml=<fetch returntotalrecordcount='true'>",
                                        "  <entity name='res_attendance'>",
                                        "    <filter>",
                                        "      <condition attribute='res_classroombooking' operator='eq' value='", lessonId, "'/>",
                                        "      <condition attribute='res_participationmode' operator='eq' value='1'/>",
                                        "      <condition attribute='statecode' operator='eq' value='0'/>",
                                        "    </filter>",
                                        "  </entity>",
                                        "</fetch>"
                                    ].join("");

                                    Xrm.WebApi.retrieveMultipleRecords("res_attendance", fetchXml).then(
                                        results => {
                                            if (results.entities.length === classroomSeats && participationMode) {
                                                errorMessage = "Non ci sono pi\u00F9 posti disponibili";
                                                formContext.getControl(fields.participationMode).setNotification(errorMessage);
                                            }
                                        },
                                        error => { console.log(error.message); }
                                    );
                                },
                                error => { console.log(error.message); }
                            );
                        }
                    }
                    if (errorMessage) formContext.getControl(fields.participationMode).setNotification(errorMessage);
                },
                error => { console.log(error.message); });
        }
    }

    _self.onChangeTime = executionContext => {
        const formContext = executionContext.getFormContext();
        const eventSourceAttribute = executionContext.getEventSource();
        const eventSourceControl = formContext.getControl(eventSourceAttribute.getName());

        try {

            const fieldsToCheck = {
                startTime: fields.startingTime,
                endTime: fields.endingTime,
            };

            const fieldsValuesMinutes = {};

            const fieldsValues = {};

            //cancello le notifiche di errore
            Object.keys(fieldsToCheck).forEach(fieldKey => {
                formContext.getControl(fieldsToCheck[fieldKey]).clearNotification();
            });

            //salvo i valori inseriti nei campi
            Object.keys(fieldsToCheck).forEach(fieldKey => {
                fieldsValues[fieldKey] = formContext.getAttribute(fieldsToCheck[fieldKey]).getValue();
            })

            //converto i valori inseriti in minuti
            Object.keys(fieldsValues).forEach(fieldKey => {
                if (fieldsValues[fieldKey]) fieldsValuesMinutes[fieldKey] = timeStringToMinutes(fieldsValues[fieldKey]);
            })

            //formatto i valori inseriti nei campi
            Object.keys(fieldsToCheck).forEach(fieldKey => {
                if (fieldsValues[fieldKey]) formContext.getAttribute(fieldsToCheck[fieldKey]).setValue(formatTime(fieldsValues[fieldKey]));
            })

            const lesson = formContext.getAttribute(fields.lesson).getValue();

            if (lesson) {
                const lessonId = formContext.getAttribute(fields.lesson).getValue()[0].id;

                Xrm.WebApi.retrieveRecord("res_classroombooking", lessonId, "?$select=res_intendedstartingtime, res_intendedendingtime").then(
                    lesson => {
                        const intendedStartingTime = timeStringToMinutes(lesson.res_intendedstartingtime);
                        const intendedEndingTime = timeStringToMinutes(lesson.res_intendedendingtime);

                        console.log('intendedStartingTime' + intendedStartingTime);
                        console.log('intendedStartingTime' + intendedStartingTime);
                        try {
                            if (!isInRange(intendedStartingTime, intendedEndingTime, fieldsValuesMinutes.startTime))
                                throw new Error("L'ora di inizio della presenza non pu\u00F2 cadere fuori dall'orario della lezione.");

                            if (!isInRange(intendedStartingTime, intendedEndingTime, fieldsValuesMinutes.endTime))
                                throw new Error("L'ora di fine della presenza non pu\u00F2 cadere fuori dall'orario della lezione.");

                        } catch (error) {
                            eventSourceControl.setNotification(error.message);
                        }
                    },
                    error => {
                        console.log(error.message);
                    }
                );
            } else {
                console.log("lesson not found");
            }

            if (fieldsValuesMinutes.startTime && fieldsValuesMinutes.endTime) {
                if (fieldsValuesMinutes.startTime > fieldsValuesMinutes.endTime)
                    throw new Error('Ora Inizio non può essere antecedente a Ora Fine');
            }
        } catch (error) {
            eventSourceControl.setNotification(error.message);
        }
    };

    // Event handler for save
    _self.onSaveForm = function (executionContext) {
        if (executionContext.getEventArgs().getSaveMode() == 70) {
            executionContext.getEventArgs().preventDefault();
            return;
        }
    };

    // Event handler for create form load
    _self.onLoadCreateForm = async function (executionContext) {
        var formContext = executionContext.getFormContext();
    };

    // Event handler for update form load
    _self.onLoadUpdateForm = async function (executionContext) {
        var formContext = executionContext.getFormContext();
    };

    // Event handler for read-only form load
    _self.onLoadReadyOnlyForm = function (executionContext) {
        var formContext = executionContext.getFormContext();
    };


    _self.onLoadForm = async function (executionContext) {
        await import('../res_scripts/utils.js');

        var formContext = executionContext.getFormContext();

        // Init events
        formContext.data.entity.addOnSave(_self.onSaveForm);

        formContext.getAttribute(fields.participationMode).addOnChange(_self.onChangeParticipationMode);
        formContext.getAttribute(fields.lesson).addOnChange(_self.fillLessonRelatedFields);
        formContext.getAttribute(fields.startingTime).addOnChange(_self.onChangeTime);
        formContext.getAttribute(fields.endingTime).addOnChange(_self.onChangeTime);

        // Init functions   
        _self.fillLessonRelatedFields(executionContext);
        _self.checkAvailableParticipationMode(executionContext);

        switch (formContext.ui.getFormType()) {
            case CREATE_FORM:
                await _self.onLoadCreateForm(executionContext);
                break;
            case UPDATE_FORM:
                await _self.onLoadUpdateForm(executionContext);
                break;
        }
    };
}).call(FM.MDP.ATTENDANCE);
